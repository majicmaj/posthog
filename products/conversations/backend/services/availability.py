"""Reading and changing whether agents are taking tickets.

An unavailable agent is skipped by ticket assignment and has their open work handed to the
group they nominated. Becoming available again only makes them assignable: tickets already
handed off stay where they went, because someone else may have picked them up.
"""

from __future__ import annotations

from django.db import transaction

from posthog.models.organization import Organization
from posthog.models.user import User

from products.conversations.backend.models import AgentAvailability


class UnchangedHandoffRole:
    """Marker type for "leave the handoff group as it is"."""


UNCHANGED_HANDOFF_ROLE = UnchangedHandoffRole()


def is_available(organization_id: str, user_id: int) -> bool:
    """Whether this agent is taking tickets. No row means available."""
    return not AgentAvailability.objects.filter(
        organization_id=organization_id, user_id=user_id, is_available=False
    ).exists()


def set_availability(
    *,
    organization: Organization,
    target_user_id: int,
    actor: User | None,
    is_available: bool,
    handoff_role_id: str | None | UnchangedHandoffRole = UNCHANGED_HANDOFF_ROLE,
) -> bool:
    """Change an agent's availability. Returns whether the availability actually changed.

    Becoming unavailable hands the agent's open tickets over in the background: an agent can
    hold more tickets than one request should walk through, and the state has to take effect
    immediately either way so nothing new lands on them while the handoff runs.

    ``handoff_role_id`` defaults to leaving the stored group alone, so a caller that only wants to
    flip availability can't wipe a choice it never knew about. Pass ``None`` to clear it.
    """
    # Imported here to break the tasks -> services -> tasks import cycle: the Celery task calls
    # back into this module to re-check availability between batches.
    from products.conversations.backend.tasks import hand_off_unavailable_agent_tickets  # noqa: PLC0415

    with transaction.atomic():
        # Land the row in the neutral available state first so a double-click races on the
        # unique constraint here, where get_or_create handles it, rather than on the update.
        availability, _ = AgentAvailability.objects.get_or_create(
            organization=organization,
            user_id=target_user_id,
            defaults={"is_available": True},
        )
        availability = AgentAvailability.objects.select_for_update().get(pk=availability.pk)

        was_available = availability.is_available
        availability.is_available = is_available
        availability.changed_by = actor
        update_fields = ["is_available", "changed_by", "updated_at"]
        if not isinstance(handoff_role_id, UnchangedHandoffRole):
            availability.handoff_role_id = handoff_role_id
            update_fields.append("handoff_role")
        availability.save(update_fields=update_fields)

        changed = was_available != is_available
        if changed and not is_available:
            # Queued on commit so the task can never read the row before it lands.
            transaction.on_commit(
                lambda: hand_off_unavailable_agent_tickets.delay(str(organization.id), target_user_id)
            )

    return changed
