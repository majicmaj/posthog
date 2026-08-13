import json
from datetime import UTC, datetime, timedelta

from posthog.test.base import BaseTest
from unittest.mock import MagicMock, patch

from django.apps import apps
from django.test import Client, RequestFactory, SimpleTestCase
from django.utils import timezone

from parameterized import parameterized

from posthog.models.comment import Comment
from posthog.models.organization import OrganizationMembership
from posthog.models.user import User

from products.conversations.backend.api.email_events import MAX_RECIPIENTS, _parse_addresses, _parse_sent_at
from products.conversations.backend.models import (
    EMAIL_THREAD_COMMENT_SCOPE,
    EmailChannel,
    EmailChannelConnectionStatus,
    EmailChannelKind,
    EmailChannelSetup,
    EmailChannelSetupProvider,
    EmailOutboxMessage,
    EmailThread,
    EmailThreadAccountLink,
    EmailThreadMessage,
    EmailThreadMessageDirection,
    Ticket,
)
from products.customer_analytics.backend.facade.email_matching import recalculate_email_thread_links


class TestCustomerEmailIngestion(BaseTest):
    def setUp(self) -> None:
        super().setUp()
        self.client = Client()
        self.channel = EmailChannel.objects.create(
            team=self.team,
            kind=EmailChannelKind.CUSTOMER_COMMUNICATION,
            owner=self.user,
            inbound_token="c0570a111",
            from_email="csm@example.com",
            from_name="Customer success",
            domain="example.com",
            domain_verified=True,
            connection_status=EmailChannelConnectionStatus.ACTIVE,
        )
        signature_patcher = patch(
            "products.conversations.backend.api.email_events.validate_webhook_signature",
            return_value=True,
        )
        signature_patcher.start()
        self.addCleanup(signature_patcher.stop)

    def _post_email(
        self,
        *,
        message_id: str,
        recipient: str = "team-c0570a111@mg.posthog.com",
        **overrides: str,
    ):
        data = {
            "token": "webhook-token",
            "timestamp": "1749565800",
            "signature": "webhook-signature",
            "recipient": recipient,
            "from": "Example customer <customer@customer.example>",
            "sender": "customer@customer.example",
            "To": "CSM <csm@example.com>",
            "Message-Id": message_id,
            "Date": "Tue, 10 Jun 2025 14:30:00 +0000",
            "subject": "Account question",
            "stripped-text": "Can you help?",
            "body-plain": "Can you help?",
        }
        data.update(overrides)
        return self.client.post("/api/conversations/v1/email/inbound", data)

    def _post_outbound_email(
        self,
        *,
        message_id: str,
        lookup_only: str = "",
        **overrides: str,
    ):
        data = {
            "token": "webhook-token",
            "timestamp": "1749565800",
            "signature": "webhook-signature",
            "recipient": "sent@mg.posthog.com",
            "from": "Customer success <csm@example.com>",
            "sender": "csm@example.com",
            "To": "Prospect <prospect@future.example>",
            "Message-Id": message_id,
            "Date": "Tue, 10 Jun 2025 14:00:00 +0000",
            "subject": "Account update",
            "stripped-text": "Here is your account update.",
            "body-plain": "Here is your account update.",
            "message-headers": json.dumps(
                [
                    ["X-Mailgun-Spf", "Fail"],
                    ["X-Mailgun-Dkim-Check-Result", "Pass"],
                    ["DKIM-Signature", "v=1; a=rsa-sha256; d=example.com; s=mail"],
                ]
            ),
        }
        data.update(overrides)
        endpoint = (
            "/api/conversations/v1/email/capture?sender_lookup=1"
            if lookup_only == "1"
            else "/api/conversations/v1/email/capture"
        )
        return self.client.post(endpoint, data)

    def _start_google_setup(self, *, expires_at=None) -> EmailChannelSetup:
        self.channel.connection_status = EmailChannelConnectionStatus.PENDING_CONFIRMATION
        self.channel.save(update_fields=["connection_status"])
        return EmailChannelSetup.objects.for_team(self.team.id).create(
            team=self.team,
            channel=self.channel,
            provider=EmailChannelSetupProvider.GOOGLE,
            expires_at=expires_at or timezone.now() + timedelta(hours=24),
        )

    def _valid_google_confirmation(self, *, action_suffix: str = "expected") -> dict[str, str]:
        action = f"https://mail-settings.google.com/mail/vf-{action_suffix}"
        return {
            "from": "Gmail forwarding <forwarding-noreply@google.com>",
            "sender": "forwarding-noreply@google.com",
            "subject": "(#12345678) Gmail Forwarding Confirmation - Receive Mail from csm@example.com",
            "body-plain": f"Confirm forwarding by visiting {action}",
            "stripped-text": f"Confirm forwarding by visiting {action}",
            "X-Mailgun-Spf": "pass",
            "X-Mailgun-Dkim-Check-Result": "pass",
            "DKIM-Signature": ("v=1; a=rsa-sha256; d=google.com; s=20230601; h=from:to:subject:date; b=signature"),
        }

    def test_pending_channel_stores_only_the_first_authenticated_google_confirmation(self) -> None:
        setup = self._start_google_setup()

        first_response = self._post_email(
            message_id="<forwarding-confirmation@gmail.com>",
            **self._valid_google_confirmation(),
        )
        second_response = self._post_email(
            message_id="<second-forwarding-confirmation@gmail.com>",
            **self._valid_google_confirmation(action_suffix="replacement"),
        )

        assert first_response.status_code == 200
        assert second_response.status_code == 200
        setup.refresh_from_db()
        assert setup.confirmation_action == "https://mail-settings.google.com/mail/vf-expected"
        assert setup.confirmation_message_id_hash
        assert setup.confirmation_received_at is not None
        assert not EmailThread.objects.for_team(self.team.id).exists()
        assert not Ticket.objects.filter(team=self.team).exists()
        assert not EmailOutboxMessage.objects.filter(team=self.team).exists()

    def test_pending_channel_accepts_live_mailgun_confirmation_shape(self) -> None:
        setup = self._start_google_setup()
        payload = self._valid_google_confirmation()
        payload["subject"] = "(PostHog Forwarding Confirmation - Receive Mail from csm@example.com"
        payload["body-plain"] = (
            "Confirm forwarding at https://mail.google.com/mail/vf-%5Blive_token%5D-value or reject it at "
            "https://mail.google.com/mail/uf-live-token"
        )
        payload["stripped-text"] = payload["body-plain"]
        payload["message-headers"] = json.dumps(
            [
                ["X-Mailgun-Spf", payload.pop("X-Mailgun-Spf")],
                ["X-Mailgun-Dkim-Check-Result", payload.pop("X-Mailgun-Dkim-Check-Result")],
                ["DKIM-Signature", payload.pop("DKIM-Signature")],
            ]
        )

        response = self._post_email(message_id="<live-forwarding-confirmation@gmail.com>", **payload)

        assert response.status_code == 200
        setup.refresh_from_db()
        assert setup.confirmation_action == "https://mail.google.com/mail/vf-%5Blive_token%5D-value"
        assert setup.confirmation_received_at is not None

    @parameterized.expand(
        [
            (
                "failed_spf_and_dkim",
                {
                    "X-Mailgun-Spf": "fail",
                    "X-Mailgun-Dkim-Check-Result": "fail",
                },
            ),
            ("wrong_source", {"subject": "Gmail Forwarding Confirmation - Receive Mail from attacker@example.com"}),
            (
                "wrong_dkim_domain",
                {"DKIM-Signature": "v=1; d=attacker.example; h=from:subject; b=signature"},
            ),
            (
                "unsigned_subject",
                {"DKIM-Signature": "v=1; d=google.com; h=from:to:date; b=signature"},
            ),
            (
                "conflicting_mailgun_results",
                {
                    "X-Mailgun-Spf": "fail",
                    "X-Mailgun-Dkim-Check-Result": "fail",
                    "DKIM-Signature": "",
                    "message-headers": json.dumps(
                        [
                            ["X-Mailgun-Spf", "pass"],
                            ["X-Mailgun-Dkim-Check-Result", "pass"],
                            ["DKIM-Signature", "v=1; d=google.com; h=from:subject; b=forged"],
                        ]
                    ),
                },
            ),
            (
                "mixed_dkim_domains",
                {
                    "DKIM-Signature": "",
                    "message-headers": json.dumps(
                        [
                            ["DKIM-Signature", "v=1; d=google.com; h=from:subject; b=forged"],
                            ["DKIM-Signature", "v=1; d=attacker.example; h=from:subject; b=valid"],
                        ]
                    ),
                },
            ),
            (
                "lookalike_action_host",
                {
                    "body-plain": "https://mail-settings.google.com.attacker.example/mail/vf-token",
                    "stripped-text": "https://mail-settings.google.com.attacker.example/mail/vf-token",
                },
            ),
        ]
    )
    def test_pending_channel_discards_untrusted_confirmation_candidates(
        self, _name: str, overrides: dict[str, str]
    ) -> None:
        setup = self._start_google_setup()
        payload = self._valid_google_confirmation()
        payload.update(overrides)

        response = self._post_email(message_id=f"<{_name}@gmail.com>", **payload)

        assert response.status_code == 200
        setup.refresh_from_db()
        assert setup.confirmation_action is None
        assert not EmailThread.objects.for_team(self.team.id).exists()

    def test_expired_setup_is_deleted_and_discards_email(self) -> None:
        setup = self._start_google_setup(expires_at=timezone.now() - timedelta(seconds=1))

        response = self._post_email(
            message_id="<expired-forwarding-confirmation@gmail.com>",
            **self._valid_google_confirmation(),
        )

        assert response.status_code == 200
        assert not EmailChannelSetup.objects.for_team(self.team.id).filter(id=setup.id).exists()
        self.channel.refresh_from_db()
        assert self.channel.connection_status == EmailChannelConnectionStatus.CONFIRMATION_EXPIRED
        assert not EmailThread.objects.for_team(self.team.id).exists()

    @parameterized.expand(["in_reply_to", "references"])
    def test_rfc_reply_headers_continue_the_existing_thread(self, header_kind: str) -> None:
        root_message_id = f"<root-{header_kind}@customer.example>"
        root_response = self._post_email(
            message_id=root_message_id,
            **{
                "X-Mailgun-Spf": "pass",
                "body-plain": "Initial message with forwarded context",
                "stripped-text": "Initial message",
            },
        )
        reply_fields = {
            "Date": "Tue, 10 Jun 2025 15:30:00 +0000",
            "body-plain": "Reply only\n\nOn Tuesday, Customer success wrote:\n> Initial message",
            "stripped-text": "Reply only",
        }
        if header_kind == "in_reply_to":
            reply_fields["In-Reply-To"] = root_message_id
        else:
            reply_fields["References"] = f"<older@customer.example> {root_message_id}"

        reply_response = self._post_email(
            message_id=f"<reply-{header_kind}@customer.example>",
            **reply_fields,
        )

        assert root_response.status_code == 200
        assert reply_response.status_code == 200
        thread = EmailThread.objects.for_team(self.team.id).get()
        messages = list(
            EmailThreadMessage.objects.for_team(self.team.id).filter(thread=thread).select_related("comment")
        )
        assert thread.message_count == 2
        assert thread.preview == "Reply only"
        assert len(messages) == 2
        assert messages[0].sender_authenticated is True
        assert messages[0].comment.content == "Initial message with forwarded context"
        assert messages[1].comment.content == "Reply only"
        assert messages[1].in_reply_to == (root_message_id if header_kind == "in_reply_to" else None)
        assert messages[1].references == (
            [] if header_kind == "in_reply_to" else ["<older@customer.example>", root_message_id]
        )

    @patch(
        "products.conversations.backend.services.email_thread_ingestion.schedule_email_thread_link_recalculation_for_threads"
    )
    def test_forwarded_message_schedules_account_matching(self, mock_schedule: MagicMock) -> None:
        response = self._post_email(message_id="<linked@customer.example>")

        assert response.status_code == 200
        thread = EmailThread.objects.for_team(self.team.id).get()
        mock_schedule.assert_called_once_with(self.team.id, [str(thread.id)])

    @patch(
        "products.customer_analytics.backend.facade.email_matching.current_app.send_task",
        side_effect=Exception("account matching backend unavailable"),
    )
    def test_account_link_recalculation_failure_does_not_fail_ingestion(self, _mock_send_task: MagicMock) -> None:
        with self.captureOnCommitCallbacks(execute=True):
            response = self._post_email(message_id="<recalc-fails@customer.example>")

        assert response.status_code == 200
        thread = EmailThread.objects.for_team(self.team.id).get()
        assert EmailThreadMessage.objects.for_team(self.team.id).filter(thread=thread).count() == 1
        assert not EmailThreadAccountLink.objects.for_team(self.team.id).exists()

    def test_outbound_message_is_recovered_when_a_later_reply_matches_an_account(self) -> None:
        outbound_message_id = "<outbound@customer-success.example>"
        outbound_response = self._post_outbound_email(message_id=outbound_message_id)

        assert outbound_response.status_code == 200
        thread = EmailThread.objects.for_team(self.team.id).get()
        assert not EmailThreadAccountLink.objects.for_team(self.team.id).filter(thread=thread).exists()

        account_model = apps.get_model("customer_analytics", "Account")
        account = account_model.objects.for_team(self.team.id).create(
            team=self.team,
            name="Future account",
            external_id="future-account",
            _properties={"known_emails": ["prospect@future.example"]},
        )
        reply_response = self._post_email(
            message_id="<reply@future.example>",
            **{
                "from": "Prospect <prospect@future.example>",
                "sender": "prospect@future.example",
                "To": "Customer success <csm@example.com>",
                "In-Reply-To": outbound_message_id,
                "Date": "Tue, 10 Jun 2025 15:00:00 +0000",
                "body-plain": "Thanks for the update.",
                "stripped-text": "Thanks for the update.",
                "X-Mailgun-Spf": "pass",
            },
        )

        assert reply_response.status_code == 200
        recalculate_email_thread_links(self.team.id, thread_ids=[str(thread.id)])
        thread.refresh_from_db()
        messages = list(EmailThreadMessage.objects.for_team(self.team.id).filter(thread=thread))
        assert thread.message_count == 2
        assert [message.direction for message in messages] == [
            EmailThreadMessageDirection.OUTBOUND,
            EmailThreadMessageDirection.INBOUND,
        ]
        assert messages[0].sender_email == "csm@example.com"
        assert messages[0].sender_authenticated is True
        assert messages[1].in_reply_to == outbound_message_id
        link = EmailThreadAccountLink.objects.for_team(self.team.id).get(thread=thread)
        assert link.account_id == str(account.id)
        assert not Ticket.objects.filter(team=self.team).exists()
        assert not EmailOutboxMessage.objects.filter(team=self.team).exists()

    @parameterized.expand(
        [
            ("different_envelope", {"sender": "attacker@example.com"}),
            (
                "unaligned_dkim",
                {
                    "message-headers": json.dumps(
                        [
                            ["X-Mailgun-Spf", "Fail"],
                            ["X-Mailgun-Dkim-Check-Result", "Pass"],
                            ["DKIM-Signature", "v=1; a=rsa-sha256; d=attacker.example; s=mail"],
                        ]
                    )
                },
            ),
            (
                "conflicting_authentication_results",
                {
                    "message-headers": json.dumps(
                        [
                            ["X-Mailgun-Spf", "Fail"],
                            ["X-Mailgun-Spf", "Pass"],
                            ["X-Mailgun-Dkim-Check-Result", "Fail"],
                            ["X-Mailgun-Dkim-Check-Result", "Pass"],
                            ["DKIM-Signature", "v=1; a=rsa-sha256; d=example.com; s=mail"],
                        ]
                    )
                },
            ),
        ]
    )
    def test_outbound_capture_rejects_an_unauthenticated_sender(self, _name: str, overrides: dict[str, str]) -> None:
        response = self._post_outbound_email(
            message_id=f"<spoofed-{_name}@customer-success.example>",
            **overrides,
        )

        assert response.status_code == 200
        assert not EmailThread.objects.for_team(self.team.id).exists()

    @parameterized.expand(
        [
            ("secondary_absent", 404, 200, True),
            ("sender_in_both_regions", 204, 200, False),
            ("secondary_unavailable", None, 502, False),
            ("secondary_error", 500, 502, False),
        ]
    )
    @patch("products.conversations.backend.api.email_events.request_secondary_region_status")
    @patch("products.conversations.backend.api.email_events.is_primary_region", return_value=True)
    def test_primary_region_checks_secondary_before_ingesting(
        self,
        _name: str,
        secondary_status: int | None,
        expected_status: int,
        expected_ingestion: bool,
        _mock_primary: MagicMock,
        mock_secondary_status: MagicMock,
    ) -> None:
        mock_secondary_status.return_value = secondary_status

        response = self._post_outbound_email(message_id=f"<region-{_name}@example.com>")

        assert response.status_code == expected_status
        assert EmailThread.objects.for_team(self.team.id).exists() is expected_ingestion

    @parameterized.expand(
        [
            ("active", EmailChannelConnectionStatus.ACTIVE, 204),
            ("pending_confirmation", EmailChannelConnectionStatus.PENDING_CONFIRMATION, 404),
            ("confirmation_expired", EmailChannelConnectionStatus.CONFIRMATION_EXPIRED, 404),
        ]
    )
    def test_outbound_sender_lookup_returns_only_active_channels(
        self, _name: str, connection_status: EmailChannelConnectionStatus, expected_status: int
    ) -> None:
        self.channel.connection_status = connection_status
        self.channel.save(update_fields=["connection_status"])

        response = self._post_outbound_email(
            message_id=f"<lookup-{_name}@customer-success.example>",
            lookup_only="1",
        )

        assert response.status_code == expected_status
        assert not EmailThread.objects.for_team(self.team.id).exists()

    @parameterized.expand(
        [
            ("pending_confirmation", EmailChannelConnectionStatus.PENDING_CONFIRMATION),
            ("confirmation_expired", EmailChannelConnectionStatus.CONFIRMATION_EXPIRED),
        ]
    )
    def test_outbound_capture_skips_non_active_channels(
        self, _name: str, connection_status: EmailChannelConnectionStatus
    ) -> None:
        self.channel.connection_status = connection_status
        self.channel.save(update_fields=["connection_status"])

        response = self._post_outbound_email(message_id=f"<outbound-{_name}@customer-success.example>")

        assert response.status_code == 200
        assert not EmailThread.objects.for_team(self.team.id).exists()

    def test_outbound_capture_drops_internal_only_messages(self) -> None:
        colleague = User.objects.create(email="colleague@example.com", current_team=self.team)
        OrganizationMembership.objects.create(
            organization=self.organization,
            user=colleague,
            level=OrganizationMembership.Level.MEMBER,
        )

        response = self._post_outbound_email(
            message_id="<internal@example.com>",
            To="Colleague <colleague@example.com>",
        )

        assert response.status_code == 200
        assert not EmailThread.objects.for_team(self.team.id).exists()

    def test_duplicate_delivery_creates_one_message_across_customer_channels(self) -> None:
        message_id = "<duplicate@customer.example>"
        first_response = self._post_email(message_id=message_id)
        retry_response = self._post_email(message_id=message_id)

        second_owner = User.objects.create(email="second-csm@example.com", current_team=self.team)
        OrganizationMembership.objects.create(
            organization=self.organization,
            user=second_owner,
            level=OrganizationMembership.Level.MEMBER,
        )
        EmailChannel.objects.create(
            team=self.team,
            kind=EmailChannelKind.CUSTOMER_COMMUNICATION,
            owner=second_owner,
            inbound_token="5ec00dc5a",
            from_email=second_owner.email,
            from_name="Second CSM",
            domain="example.com",
            domain_verified=True,
            connection_status=EmailChannelConnectionStatus.ACTIVE,
        )
        second_owner_response = self._post_email(
            message_id=message_id,
            recipient="team-5ec00dc5a@mg.posthog.com",
        )

        assert first_response.status_code == 200
        assert retry_response.status_code == 200
        assert second_owner_response.status_code == 200
        thread = EmailThread.objects.for_team(self.team.id).get()
        assert thread.message_count == 1
        assert EmailThreadMessage.objects.for_team(self.team.id).filter(thread=thread).count() == 1
        assert (
            Comment.objects.filter(team=self.team, scope=EMAIL_THREAD_COMMENT_SCOPE, item_id=str(thread.id)).count()
            == 1
        )

    def test_dangling_owner_is_acked_without_a_server_error(self) -> None:
        # owner is a db_constraint=False FK, so a deleted owner leaves owner_id pointing at a missing
        # user while satisfying the not-null check constraint; channel.owner then resolves to None and
        # ingestion raises. The webhook must ack (200) rather than 500 into a Mailgun retry loop.
        EmailChannel.objects.filter(id=self.channel.id).update(owner_id=987654321)

        response = self._post_email(message_id="<dangling-owner@customer.example>")

        assert response.status_code == 200
        assert not EmailThread.objects.for_team(self.team.id).exists()


class TestParseAddresses(SimpleTestCase):
    def test_recipient_count_is_capped(self) -> None:
        header = ", ".join(f"user{index}@example.com" for index in range(MAX_RECIPIENTS + 50))

        parsed = _parse_addresses(header)

        assert len(parsed) == MAX_RECIPIENTS


class TestParseSentAt(SimpleTestCase):
    factory = RequestFactory()

    @parameterized.expand(
        [
            # A far-future Date header is rejected and falls back to the authenticated timestamp.
            ("future_date_rejected", "Mon, 1 Jan 2999 00:00:00 +0000", datetime(2025, 6, 10, 14, 30, tzinfo=UTC)),
            # A plausible past Date header is kept as-is, not overridden by the timestamp.
            ("valid_past_date_kept", "Wed, 1 Jan 2025 00:00:00 +0000", datetime(2025, 1, 1, 0, 0, tzinfo=UTC)),
        ]
    )
    def test_parse_sent_at(self, _name: str, date_header: str, expected: datetime) -> None:
        request = self.factory.post("/", {"Date": date_header, "timestamp": "1749565800"})

        assert _parse_sent_at(request) == expected
