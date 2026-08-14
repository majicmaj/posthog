import os
import signal
import socket
import asyncio
import secrets
from datetime import timedelta
from functools import partial
from pathlib import Path
from time import monotonic

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone as django_timezone

from asgiref.sync import sync_to_async
from prometheus_client import start_http_server
from temporalio.client import Client
from temporalio.common import RetryPolicy, WorkflowIDReusePolicy
from temporalio.exceptions import WorkflowAlreadyStartedError

from posthog.models.team.team import Team
from posthog.temporal.common.client import async_connect

from products.tasks.backend.logic.services.workflow_dispatch import (
    claim_dispatches,
    mark_accepted,
    mark_dead,
    parse_create_payload,
    release_claims,
    renew_leases,
    reschedule,
    resolve_ineligible,
    sample_dispatch_metrics,
)
from products.tasks.backend.metrics import (
    WORKFLOW_DISPATCH_ATTEMPT_TOTAL,
    WORKFLOW_DISPATCH_START_DURATION_SECONDS,
    observe_task_run_workflow_start,
)
from products.tasks.backend.models import TaskRun, TaskWorkflowDispatch
from products.tasks.backend.temporal.client import _capture_run_feature_flags
from products.tasks.backend.temporal.process_task.workflow import ProcessTaskInput


class Command(BaseCommand):
    help = "Dispatch queued task workflows from the durable outbox"

    def handle(self, *args: object, **options: object) -> None:
        start_http_server(8001)
        asyncio.run(self._run())

    async def _run(self) -> None:
        instance_id = f"{socket.gethostname()}:{os.getpid()}:{secrets.token_hex(4)}"
        stop = asyncio.Event()
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(sig, stop.set)
        client = await async_connect()
        Path("/tmp/dispatcher-ready").touch()
        semaphore = asyncio.Semaphore(settings.TASKS_DISPATCHER_CONCURRENCY)
        lease = timedelta(seconds=settings.TASKS_DISPATCHER_LEASE_SECONDS)
        in_flight: set[asyncio.Task[None]] = set()
        in_flight_ids: set[object] = set()
        renewer = asyncio.create_task(self._renew(instance_id, in_flight_ids, lease, stop))
        last_metrics_sample = 0.0
        try:
            while not stop.is_set():
                Path("/tmp/dispatcher-heartbeat").touch()
                if monotonic() - last_metrics_sample >= 15:
                    await sync_to_async(sample_dispatch_metrics)()
                    last_metrics_sample = monotonic()
                available_capacity = settings.TASKS_DISPATCHER_CONCURRENCY - len(in_flight)
                if available_capacity <= 0:
                    await asyncio.wait(in_flight, return_when=asyncio.FIRST_COMPLETED)
                    continue
                rows = await sync_to_async(claim_dispatches)(
                    instance_id, min(settings.TASKS_DISPATCHER_BATCH_SIZE, available_capacity), lease
                )
                if not rows:
                    try:
                        await asyncio.wait_for(stop.wait(), timeout=settings.TASKS_DISPATCHER_POLL_INTERVAL_SECONDS)
                    except TimeoutError:
                        pass
                    continue
                for dispatch in rows:
                    in_flight_ids.add(dispatch.id)
                    task = asyncio.create_task(self._process(client, dispatch, instance_id, semaphore))
                    in_flight.add(task)
                    task.add_done_callback(in_flight.discard)
                    task.add_done_callback(partial(self._discard_dispatch_id, in_flight_ids, dispatch.id))
        finally:
            if in_flight:
                await asyncio.gather(*in_flight, return_exceptions=True)
            stop.set()
            await renewer
            await sync_to_async(release_claims)(instance_id)

    async def _renew(self, instance_id: str, dispatch_ids: set[object], lease: timedelta, stop: asyncio.Event) -> None:
        while not stop.is_set():
            try:
                await asyncio.wait_for(stop.wait(), timeout=20)
            except TimeoutError:
                if dispatch_ids:
                    await sync_to_async(renew_leases)(instance_id, list(dispatch_ids), lease)

    @staticmethod
    def _discard_dispatch_id(dispatch_ids: set[object], dispatch_id: object, _task: asyncio.Task[None]) -> None:
        dispatch_ids.discard(dispatch_id)

    async def _process(
        self, client: Client, dispatch: TaskWorkflowDispatch, instance_id: str, semaphore: asyncio.Semaphore
    ) -> None:
        async with semaphore:
            run = await TaskRun.objects.select_related("task").aget(id=dispatch.task_run_id)
            if run.status != TaskRun.Status.QUEUED:
                await sync_to_async(resolve_ineligible)(dispatch.id, instance_id)
                WORKFLOW_DISPATCH_ATTEMPT_TOTAL.labels(kind=dispatch.dispatch_kind, outcome="resolved_ineligible").inc()
                return
            if django_timezone.now() - dispatch.created_at > timedelta(
                seconds=settings.TASKS_DISPATCHER_MAX_DISPATCH_AGE_SECONDS
            ):
                await sync_to_async(mark_dead)(dispatch.id, instance_id, "Workflow dispatch exceeded maximum age")
                WORKFLOW_DISPATCH_ATTEMPT_TOTAL.labels(kind=dispatch.dispatch_kind, outcome="dead").inc()
                return
            try:
                await Team.objects.aget(id=run.team_id)
                options = parse_create_payload(dispatch.payload)
                await sync_to_async(_capture_run_feature_flags)(str(run.id))
                workflow_input = ProcessTaskInput(
                    run_id=str(run.id),
                    create_pr=options.create_pr,
                    slack_thread_context=options.slack_thread_context,
                    posthog_mcp_scopes=options.posthog_mcp_scopes,
                    prewarmed=options.prewarmed,
                    initial_message=options.initial_message,
                )
            except (Team.DoesNotExist, ValueError, KeyError, TypeError) as error:
                await sync_to_async(mark_dead)(dispatch.id, instance_id, str(error))
                WORKFLOW_DISPATCH_ATTEMPT_TOTAL.labels(kind=dispatch.dispatch_kind, outcome="dead").inc()
                return
            started = monotonic()
            try:
                await client.start_workflow(
                    "process-task",
                    workflow_input,
                    id=dispatch.workflow_id,
                    id_reuse_policy=WorkflowIDReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY,
                    task_queue=settings.TASKS_TASK_QUEUE,
                    retry_policy=RetryPolicy(maximum_attempts=1),
                    rpc_timeout=timedelta(seconds=settings.TASKS_DISPATCHER_RPC_TIMEOUT_SECONDS),
                )
            except WorkflowAlreadyStartedError:
                await sync_to_async(mark_accepted)(dispatch.id, instance_id)
                WORKFLOW_DISPATCH_ATTEMPT_TOTAL.labels(kind=dispatch.dispatch_kind, outcome="already_started").inc()
            except Exception as error:
                await sync_to_async(reschedule)(dispatch.id, instance_id, str(error))
                WORKFLOW_DISPATCH_ATTEMPT_TOTAL.labels(kind=dispatch.dispatch_kind, outcome="rescheduled").inc()
            else:
                await sync_to_async(mark_accepted)(dispatch.id, instance_id)
                WORKFLOW_DISPATCH_ATTEMPT_TOTAL.labels(kind=dispatch.dispatch_kind, outcome="accepted").inc()
                observe_task_run_workflow_start(run, outcome="started", reason="dispatcher")
            finally:
                WORKFLOW_DISPATCH_START_DURATION_SECONDS.observe(monotonic() - started)
