from datetime import timedelta

from unittest.mock import Mock, patch

from django.db import transaction
from django.test import SimpleTestCase, TestCase
from django.utils import timezone as django_timezone

from posthog.models import Organization, Team
from posthog.models.user import User

from products.tasks.backend.facade.api import filter_uncovered_workflow_dispatch_run_ids, resume_task_run_in_cloud
from products.tasks.backend.logic.services.workflow_dispatch import (
    RestartSnapshot,
    WorkflowDispatchOptions,
    build_create_payload,
    build_restart_payload,
    create_dispatch,
    dispatch_exceeded_max_age,
    parse_create_payload,
    parse_restart_payload,
    reschedule,
    sample_dispatch_metrics,
)
from products.tasks.backend.models import Task, TaskRun, TaskWorkflowDispatch
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

    def test_restart_payload_round_trip_preserves_compensation_snapshot(self) -> None:
        snapshot = RestartSnapshot(
            status="failed",
            environment="local",
            completed_at="2026-08-14T10:00:00+00:00",
            queued_at=None,
            state={"snapshot_external_id": "snapshot-1"},
        )

        payload = build_restart_payload(42, snapshot)

        self.assertEqual(parse_restart_payload(payload), (42, snapshot))


class TestWorkflowDispatchPersistence(TestCase):
    def setUp(self) -> None:
        organization = Organization.objects.create(name="Test Org")
        self.team = Team.objects.create(organization=organization, name="Test Team")
        user = User.objects.create(email="test@example.com")
        task = Task.objects.create(
            team=self.team,
            created_by=user,
            title="Test Task",
            description="Test Description",
            origin_product=Task.OriginProduct.USER_CREATED,
        )
        self.task_run = TaskRun.objects.create(task=task, team=self.team, status=TaskRun.Status.QUEUED)

    @patch("products.tasks.backend.feature_flags.is_workflow_dispatch_restart_enabled")
    def test_restart_flag_is_evaluated_before_locking_run(self, restart_enabled: Mock) -> None:
        baseline_atomic_depth = len(transaction.get_connection().atomic_blocks)

        def assert_outside_transaction(*_args: object) -> bool:
            self.assertEqual(len(transaction.get_connection().atomic_blocks), baseline_atomic_depth)
            return True

        restart_enabled.side_effect = assert_outside_transaction

        outcome, _, _ = resume_task_run_in_cloud(self.task_run.id, self.task_run.task_id, self.team.id, None)

        self.assertEqual(outcome, "already_active")

    def test_reenqueuing_restart_resets_dispatch_age(self) -> None:
        snapshot = RestartSnapshot(
            status=TaskRun.Status.FAILED,
            environment=TaskRun.Environment.LOCAL,
            completed_at=None,
            queued_at=None,
            state={},
        )
        first_enqueued_at = django_timezone.now() - timedelta(days=1)
        with (
            patch(
                "products.tasks.backend.logic.services.workflow_dispatch.django_timezone.now",
                return_value=first_enqueued_at,
            ),
            transaction.atomic(),
        ):
            dispatch = create_dispatch(
                self.task_run,
                TaskWorkflowDispatch.Kind.RESTART,
                build_restart_payload(None, snapshot),
                self.task_run.workflow_id,
            )
        TaskWorkflowDispatch.objects.unscoped().filter(id=dispatch.id).update(created_at=first_enqueued_at)

        reenqueued_at = django_timezone.now()
        with (
            patch(
                "products.tasks.backend.logic.services.workflow_dispatch.django_timezone.now",
                return_value=reenqueued_at,
            ),
            transaction.atomic(),
        ):
            create_dispatch(
                self.task_run,
                TaskWorkflowDispatch.Kind.RESTART,
                build_restart_payload(None, snapshot),
                self.task_run.workflow_id,
            )

        dispatch.refresh_from_db()
        self.assertEqual(dispatch.enqueued_at, reenqueued_at)
        self.assertFalse(dispatch_exceeded_max_age(dispatch, 6 * 60 * 60, now=reenqueued_at))

    def test_oldest_ready_age_uses_latest_enqueue_time(self) -> None:
        now = django_timezone.now()
        snapshot = RestartSnapshot(
            status=TaskRun.Status.FAILED,
            environment=TaskRun.Environment.LOCAL,
            completed_at=None,
            queued_at=None,
            state={},
        )
        with transaction.atomic():
            dispatch = create_dispatch(
                self.task_run,
                TaskWorkflowDispatch.Kind.RESTART,
                build_restart_payload(None, snapshot),
                self.task_run.workflow_id,
            )
        TaskWorkflowDispatch.objects.unscoped().filter(id=dispatch.id).update(
            created_at=now - timedelta(days=1),
            enqueued_at=now - timedelta(minutes=5),
            next_attempt_at=now - timedelta(minutes=5),
        )

        with (
            patch("products.tasks.backend.logic.services.workflow_dispatch.django_timezone.now", return_value=now),
            patch(
                "products.tasks.backend.logic.services.workflow_dispatch.WORKFLOW_DISPATCH_OLDEST_READY_AGE_SECONDS.set"
            ) as set_oldest_age,
        ):
            sample_dispatch_metrics()

        set_oldest_age.assert_called_once_with(300.0)

    @patch("products.tasks.backend.metrics.WORKFLOW_DISPATCH_MISSING_INTENT_TOTAL.inc")
    @patch("products.tasks.backend.facade.api.is_workflow_dispatch_shadow_enabled", return_value=False)
    def test_missing_intent_metric_stays_quiet_before_shadow_rollout(
        self, _shadow_enabled: Mock, increment_missing_intent: Mock
    ) -> None:
        uncovered = filter_uncovered_workflow_dispatch_run_ids([self.task_run.id])

        self.assertEqual(uncovered, [self.task_run.id])
        increment_missing_intent.assert_not_called()
