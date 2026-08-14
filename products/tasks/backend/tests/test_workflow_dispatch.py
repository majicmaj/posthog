from unittest.mock import Mock, patch

from django.test import SimpleTestCase

from products.tasks.backend.logic.services.workflow_dispatch import (
    WorkflowDispatchOptions,
    build_create_payload,
    parse_create_payload,
    reschedule,
)
from products.tasks.backend.temporal.process_task.workflow import PendingFollowup


class TestWorkflowDispatchPayload(SimpleTestCase):
    def test_create_payload_round_trip_preserves_followup_without_secrets(self) -> None:
        options = WorkflowDispatchOptions(
            user_id=42,
            create_pr=False,
            posthog_mcp_scopes="full",
            slack_thread_context={"channel_id": "C1"},
            prewarmed=True,
            initial_message=PendingFollowup(
                message="continue",
                artifact_ids=["artifact-1"],
                actor_user_id=42,
                message_id="message-1",
            ),
        )

        payload = build_create_payload(options)

        self.assertEqual(parse_create_payload(payload), options)
        self.assertNotIn("imported_mcp_servers", payload)

    def test_unknown_payload_version_is_rejected(self) -> None:
        payload = build_create_payload(WorkflowDispatchOptions())
        payload["version"] = 2

        with self.assertRaisesRegex(ValueError, "Unsupported workflow dispatch payload version"):
            parse_create_payload(payload)

    @patch("products.tasks.backend.logic.services.workflow_dispatch.TaskWorkflowDispatch.objects")
    @patch("products.tasks.backend.logic.services.workflow_dispatch.random.uniform", return_value=1.0)
    def test_reschedule_clamps_exponential_backoff(self, uniform: Mock, objects: Mock) -> None:
        objects.unscoped.return_value.get.return_value.attempt_count = 10_000

        reschedule("dispatch-id", "instance-id", "error")

        uniform.assert_called_once_with(1.0, 256.0)
