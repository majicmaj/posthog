from posthog.test.base import APIBaseTest
from unittest.mock import patch

from parameterized import parameterized
from rest_framework import status

from posthog.models import ActivityLog, Organization, OrganizationMembership, Team, User
from posthog.models.activity_logging.activity_log import Trigger

from products.conversations.backend import tasks
from products.conversations.backend.api.tickets import assign_ticket
from products.conversations.backend.models import AgentAvailability, Ticket, TicketAssignment
from products.conversations.backend.models.constants import Channel, Status
from products.conversations.backend.tasks import hand_off_unavailable_agent_tickets

from ee.models.rbac.role import Role


class TestAgentAvailabilityAPI(APIBaseTest):
    def setUp(self):
        super().setUp()
        self.agent = User.objects.create_and_join(self.organization, "agent@example.com", None)
        self.role = Role.objects.create(name="Support", organization=self.organization)
        self.url = f"/api/organizations/{self.organization.id}/conversations/availability/"

    def _set(self, target: User, is_available: bool, handoff_role_id=None):
        return self.client.put(
            f"{self.url}{target.id}/",
            {"is_available": is_available, "handoff_role_id": handoff_role_id},
        )

    def test_list_reports_availability_and_the_handoff_group(self):
        AgentAvailability.objects.create(
            organization=self.organization,
            user=self.agent,
            is_available=False,
            handoff_role=self.role,
            changed_by=self.user,
        )

        response = self.client.get(self.url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        results = response.json()
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["user"]["email"], "agent@example.com")
        self.assertFalse(results[0]["is_available"])
        self.assertEqual(results[0]["handoff_role"], {"id": str(self.role.id), "name": "Support"})
        self.assertEqual(results[0]["changed_by"]["email"], self.user.email)

    @parameterized.expand([(True,), (False,)])
    def test_member_can_set_their_own_availability(self, is_available: bool):
        response = self._set(self.user, is_available)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["is_available"], is_available)
        self.assertEqual(
            AgentAvailability.objects.get(organization=self.organization, user=self.user).is_available,
            is_available,
        )

    def test_member_cannot_set_someone_elses_availability(self):
        self.organization_membership.level = OrganizationMembership.Level.MEMBER
        self.organization_membership.save()

        response = self._set(self.agent, False)

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(AgentAvailability.objects.filter(user=self.agent).exists())

    def test_admin_can_set_someone_elses_availability(self):
        self.organization_membership.level = OrganizationMembership.Level.ADMIN
        self.organization_membership.save()

        response = self._set(self.agent, False)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        entry = AgentAvailability.objects.get(organization=self.organization, user=self.agent)
        self.assertFalse(entry.is_available)
        self.assertEqual(entry.changed_by, self.user)

    def test_cannot_set_availability_for_someone_outside_the_organization(self):
        self.organization_membership.level = OrganizationMembership.Level.ADMIN
        self.organization_membership.save()
        outsider = User.objects.create_and_join(Organization.objects.create(name="Other org"), "out@example.com", None)

        response = self._set(outsider, False)

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertFalse(AgentAvailability.objects.filter(user=outsider).exists())

    def test_cannot_hand_off_to_a_group_from_another_organization(self):
        other_role = Role.objects.create(name="Elsewhere", organization=Organization.objects.create(name="Other org"))

        response = self._set(self.user, False, handoff_role_id=str(other_role.id))

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(AgentAvailability.objects.filter(user=self.user, is_available=False).exists())

    def test_the_handoff_group_survives_becoming_available_again(self):
        # The choice is a standing preference, so an agent picks their group once rather than
        # every time they step away.
        self._set(self.user, False, handoff_role_id=str(self.role.id))

        self._set(self.user, True, handoff_role_id=str(self.role.id))

        entry = AgentAvailability.objects.get(organization=self.organization, user=self.user)
        self.assertTrue(entry.is_available)
        self.assertEqual(entry.handoff_role, self.role)

    def test_omitting_the_handoff_group_leaves_the_stored_one_alone(self):
        # The generated clients type handoff_role_id as optional, so a call that only flips
        # availability must not destroy the group.
        self._set(self.user, True, handoff_role_id=str(self.role.id))

        response = self.client.put(f"{self.url}{self.user.id}/", {"is_available": False})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["handoff_role_id"], str(self.role.id))
        self.assertEqual(
            AgentAvailability.objects.get(organization=self.organization, user=self.user).handoff_role,
            self.role,
        )

    def test_an_out_of_range_user_id_is_not_found(self):
        # Python ints are unbounded, so an oversized id used to reach Postgres and raise DataError.
        response = self.client.put(f"{self.url}99999999999999999999/", {"is_available": False})

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_list_does_not_leak_other_organizations(self):
        other_org = Organization.objects.create(name="Other org")
        other_org.members.add(self.user)
        AgentAvailability.objects.create(organization=other_org, user=self.user, is_available=False)

        response = self.client.get(self.url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json(), [])

    @patch("products.conversations.backend.tasks.hand_off_unavailable_agent_tickets.delay")
    def test_becoming_unavailable_queues_the_handoff(self, mock_delay):
        with self.captureOnCommitCallbacks(execute=True):
            response = self._set(self.user, False)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        mock_delay.assert_called_once_with(str(self.organization.id), self.user.id)

    @parameterized.expand(
        [
            # Already unavailable — the first change queued the handoff, a repeat must not requeue.
            ("repeat_unavailable", False, False),
            ("becoming_available", False, True),
            # Setting a handoff group ahead of time, while still taking tickets.
            ("still_available", True, True),
        ]
    )
    @patch("products.conversations.backend.tasks.hand_off_unavailable_agent_tickets.delay")
    def test_queues_no_handoff_unless_the_agent_becomes_unavailable(
        self, _name: str, starts_available: bool, is_available: bool, mock_delay=None
    ):
        AgentAvailability.objects.create(organization=self.organization, user=self.user, is_available=starts_available)

        with self.captureOnCommitCallbacks(execute=True):
            response = self._set(self.user, is_available, handoff_role_id=str(self.role.id))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        mock_delay.assert_not_called()


class TestUnavailableAgentsCannotBeAssigned(APIBaseTest):
    def setUp(self):
        super().setUp()
        self.agent = User.objects.create_and_join(self.organization, "agent@example.com", None)
        self.ticket = Ticket.objects.create_with_number(
            team=self.team,
            channel_source=Channel.WIDGET,
            widget_session_id="session-1",
            distinct_id="customer-1",
            status=Status.OPEN,
        )
        self.url = f"/api/projects/{self.team.id}/conversations/tickets/{self.ticket.id}/"

    def _mark_unavailable(self, user: User) -> None:
        AgentAvailability.objects.create(organization=self.organization, user=user, is_available=False)

    def test_cannot_assign_a_ticket_to_an_unavailable_agent(self):
        self._mark_unavailable(self.agent)

        response = self.client.patch(self.url, {"assignee": {"type": "user", "id": self.agent.id}})

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("unavailable", response.json()["detail"])
        self.assertFalse(TicketAssignment.objects.filter(ticket=self.ticket).exists())

    def test_can_still_edit_a_ticket_already_assigned_to_someone_now_unavailable(self):
        # The ticket UI sends the whole form on every save, so an unchanged assignee must not
        # block editing the rest of the ticket.
        TicketAssignment.objects.create(ticket=self.ticket, user=self.agent)
        self._mark_unavailable(self.agent)

        response = self.client.patch(
            self.url,
            {"priority": "high", "assignee": {"type": "user", "id": self.agent.id}},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.ticket.refresh_from_db()
        self.assertEqual(self.ticket.priority, "high")
        self.assertEqual(TicketAssignment.objects.get(ticket=self.ticket).user, self.agent)

    def test_a_rejected_assignee_leaves_the_rest_of_the_ticket_unsaved(self):
        # The assignee arrives in the same PATCH as the other fields, so a 400 must not leave the
        # status and priority changes committed behind it.
        self._mark_unavailable(self.agent)

        response = self.client.patch(
            self.url,
            {"priority": "high", "status": Status.PENDING, "assignee": {"type": "user", "id": self.agent.id}},
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.ticket.refresh_from_db()
        self.assertIsNone(self.ticket.priority)
        self.assertEqual(self.ticket.status, Status.OPEN)

    def test_the_external_ticket_api_is_not_blocked(self):
        # No acting person means a programmatic caller, which has nobody to warn. Blocking it would
        # break tokens that already assign this way.
        self._mark_unavailable(self.agent)

        assign_ticket(
            self.ticket,
            {"type": "user", "id": self.agent.id},
            self.organization,
            None,
            self.team.id,
            False,
        )

        self.assertEqual(TicketAssignment.objects.get(ticket=self.ticket).user, self.agent)

    def test_can_take_a_ticket_yourself_while_unavailable(self):
        self._mark_unavailable(self.user)

        response = self.client.patch(self.url, {"assignee": {"type": "user", "id": self.user.id}})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(TicketAssignment.objects.get(ticket=self.ticket).user, self.user)

    def test_an_automation_can_still_assign_to_an_unavailable_agent(self):
        # A workflow assigning by rule has nobody to warn, so blocking it would quietly drop the
        # assignment step out of the rule.
        self._mark_unavailable(self.agent)

        assign_ticket(
            self.ticket,
            {"type": "user", "id": self.agent.id},
            self.organization,
            None,
            self.team.id,
            False,
            trigger=Trigger(job_type="workflow", job_id="1", payload={}),
        )

        self.assertEqual(TicketAssignment.objects.get(ticket=self.ticket).user, self.agent)

    def test_can_assign_to_a_group_whose_member_is_unavailable(self):
        # A role is a group, and the ticket is for whoever in it responds.
        self._mark_unavailable(self.agent)
        role = Role.objects.create(name="Support", organization=self.organization)

        response = self.client.patch(self.url, {"assignee": {"type": "role", "id": str(role.id)}})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(TicketAssignment.objects.get(ticket=self.ticket).role, role)


class TestHandOffUnavailableAgentTickets(APIBaseTest):
    def setUp(self):
        super().setUp()
        self.agent = User.objects.create_and_join(self.organization, "agent@example.com", None)
        self.role = Role.objects.create(name="Support", organization=self.organization)

    def _mark_unavailable(self, handoff_role: Role | None = None) -> AgentAvailability:
        return AgentAvailability.objects.create(
            organization=self.organization, user=self.agent, is_available=False, handoff_role=handoff_role
        )

    def _assigned_ticket(self, *, status: str, team: Team | None = None, user: User | None = None) -> Ticket:
        ticket = Ticket.objects.create_with_number(
            team=team or self.team,
            channel_source=Channel.WIDGET,
            widget_session_id="session-1",
            distinct_id="customer-1",
            status=status,
        )
        TicketAssignment.objects.create(ticket=ticket, user=user or self.agent)
        return ticket

    def _run(self) -> None:
        hand_off_unavailable_agent_tickets(str(self.organization.id), self.agent.id)

    @parameterized.expand(
        [
            (Status.NEW, True),
            (Status.OPEN, True),
            (Status.PENDING, True),
            (Status.ON_HOLD, True),
            # Resolved tickets record who dealt with them, so they keep their assignee.
            (Status.RESOLVED, False),
        ]
    )
    def test_hands_active_tickets_to_the_group(self, ticket_status: str, is_handed_off: bool):
        self._mark_unavailable(handoff_role=self.role)
        ticket = self._assigned_ticket(status=ticket_status)

        self._run()

        assignment = TicketAssignment.objects.get(ticket=ticket)
        self.assertEqual(assignment.role, self.role if is_handed_off else None)
        self.assertEqual(assignment.user, None if is_handed_off else self.agent)

    def test_leaves_tickets_unassigned_when_no_group_is_chosen(self):
        self._mark_unavailable(handoff_role=None)
        ticket = self._assigned_ticket(status=Status.OPEN)

        self._run()

        self.assertFalse(TicketAssignment.objects.filter(ticket=ticket).exists())

    def test_leaves_tickets_unassigned_when_the_chosen_group_was_deleted(self):
        availability = self._mark_unavailable(handoff_role=self.role)
        ticket = self._assigned_ticket(status=Status.OPEN)
        self.role.delete()
        availability.refresh_from_db()

        self._run()

        self.assertFalse(TicketAssignment.objects.filter(ticket=ticket).exists())

    def test_leaves_tickets_unassigned_when_the_chosen_group_is_deleted_mid_run(self):
        # Resolving the group once up front meant a deletion partway through failed the foreign key
        # on every remaining ticket, and the agent silently kept their whole queue.
        self._mark_unavailable(handoff_role=self.role)
        first = self._assigned_ticket(status=Status.OPEN)
        second = self._assigned_ticket(status=Status.OPEN)

        # The first ticket writes a group id that someone deleted just after it was resolved; every
        # later ticket resolves afresh and finds nothing.
        stale_role_id = self.role.id
        self.role.delete()
        real_handoff_role_id = tasks._handoff_role_id
        resolved = {"count": 0}

        def stale_on_the_first_resolve(*args, **kwargs):
            resolved["count"] += 1
            if resolved["count"] == 1:
                return stale_role_id
            return real_handoff_role_id(*args, **kwargs)

        with patch.object(tasks, "_handoff_role_id", side_effect=stale_on_the_first_resolve):
            self._run()

        # Whichever ticket raced the deletion is retried on the next pass, so the agent is left
        # holding none of them.
        self.assertFalse(TicketAssignment.objects.filter(ticket__in=[first, second], user=self.agent).exists())

    def test_records_the_handoff_on_the_ticket_timeline(self):
        self._mark_unavailable(handoff_role=self.role)
        ticket = self._assigned_ticket(status=Status.OPEN)

        self._run()

        entry = ActivityLog.objects.get(scope="Ticket", item_id=str(ticket.id), activity="assigned")
        assert entry.detail is not None
        change = entry.detail["changes"][0]
        self.assertEqual(change["field"], "assignee")
        self.assertEqual(change["before"]["user"]["email"], "agent@example.com")
        self.assertEqual(change["after"]["role"]["name"], "Support")

    def test_leaves_other_peoples_tickets_alone(self):
        self._mark_unavailable(handoff_role=self.role)
        theirs = self._assigned_ticket(status=Status.OPEN, user=self.user)

        self._run()

        self.assertEqual(TicketAssignment.objects.get(ticket=theirs).user, self.user)

    def test_leaves_other_organizations_tickets_alone(self):
        self._mark_unavailable(handoff_role=self.role)
        other_org = Organization.objects.create(name="Other org")
        other_org.members.add(self.agent)
        other_team = Team.objects.create(organization=other_org, name="Other team")
        elsewhere = self._assigned_ticket(status=Status.OPEN, team=other_team)

        self._run()

        self.assertEqual(TicketAssignment.objects.get(ticket=elsewhere).user, self.agent)

    def test_does_nothing_once_the_agent_is_available_again(self):
        # The queued task can land after they've switched back.
        ticket = self._assigned_ticket(status=Status.OPEN)

        self._run()

        self.assertEqual(TicketAssignment.objects.get(ticket=ticket).user, self.agent)

    def test_becoming_available_again_does_not_take_the_tickets_back(self):
        self._mark_unavailable(handoff_role=self.role)
        ticket = self._assigned_ticket(status=Status.OPEN)
        self._run()

        self.client.put(
            f"/api/organizations/{self.organization.id}/conversations/availability/{self.agent.id}/",
            {"is_available": True, "handoff_role_id": str(self.role.id)},
        )

        self.assertEqual(TicketAssignment.objects.get(ticket=ticket).role, self.role)
