"""Reading and changing whether agents are taking tickets.

Organization-nested rather than project-nested: assignees are validated against organization
membership, so availability applies to every project in the org.
"""

from typing import cast

from drf_spectacular.utils import extend_schema
from rest_framework import exceptions, serializers, viewsets
from rest_framework.request import Request
from rest_framework.response import Response

from posthog.api.routing import TeamAndOrgViewSetMixin
from posthog.api.shared import UserBasicSerializer
from posthog.event_usage import report_user_action
from posthog.models import OrganizationMembership
from posthog.models.user import User

from products.conversations.backend.models import AgentAvailability
from products.conversations.backend.services.availability import (
    UNCHANGED_HANDOFF_ROLE,
    UnchangedHandoffRole,
    set_availability,
)

from ee.models.rbac.role import Role


class HandoffRoleSerializer(serializers.ModelSerializer):
    """The group an agent's tickets go to while they're unavailable."""

    id = serializers.UUIDField(read_only=True, help_text="Role UUID.")
    name = serializers.CharField(read_only=True, help_text="Role name as shown in organization settings.")

    class Meta:
        model = Role
        fields = ["id", "name"]
        read_only_fields = fields


class AgentAvailabilitySerializer(serializers.ModelSerializer):
    """One agent's availability for support tickets."""

    user = UserBasicSerializer(read_only=True, help_text="The agent this availability belongs to.")
    is_available = serializers.BooleanField(read_only=True, help_text="Whether the agent is currently taking tickets.")
    handoff_role = HandoffRoleSerializer(
        read_only=True,
        allow_null=True,
        help_text=(
            "The group this agent's open tickets are handed to when they become unavailable. "
            "Null leaves those tickets unassigned instead."
        ),
    )
    changed_by = UserBasicSerializer(
        read_only=True,
        allow_null=True,
        help_text=(
            "Who last changed it: the agent themselves, or an organization admin. "
            "Null if that account has since been deleted."
        ),
    )
    updated_at = serializers.DateTimeField(read_only=True, help_text="When it last changed.")

    class Meta:
        model = AgentAvailability
        fields = ["user", "is_available", "handoff_role", "changed_by", "updated_at"]
        read_only_fields = fields


class SetAgentAvailabilitySerializer(serializers.Serializer):
    """Payload for changing one agent's availability."""

    is_available = serializers.BooleanField(
        help_text=(
            "False takes the agent out of ticket assignment and hands their open tickets to "
            "handoff_role. True makes them assignable again. Tickets already handed off are not "
            "given back."
        ),
    )
    handoff_role_id = serializers.UUIDField(
        required=False,
        allow_null=True,
        help_text=(
            "UUID of the organization role to hand this agent's open tickets to while they are "
            "unavailable. Null leaves those tickets unassigned. Remembered across availability "
            "changes, so it can be set ahead of time, and omitting it leaves the stored group as "
            "it is."
        ),
    )


class AgentAvailabilityStateSerializer(serializers.Serializer):
    """One agent's availability after a change."""

    user_id = serializers.IntegerField(read_only=True, help_text="The agent this state belongs to.")
    is_available = serializers.BooleanField(read_only=True, help_text="Whether the agent is now taking tickets.")
    handoff_role_id = serializers.UUIDField(
        read_only=True,
        allow_null=True,
        help_text="The group their open tickets are handed to while unavailable, or null for unassigned.",
    )


class AgentAvailabilityViewSet(TeamAndOrgViewSetMixin, viewsets.GenericViewSet):
    scope_object = "ticket"
    scope_object_read_actions = ["list"]
    scope_object_write_actions = ["update"]
    serializer_class = AgentAvailabilitySerializer
    queryset = AgentAvailability.objects.all()
    # Rows only exist for agents who have changed their availability, which stays small next to
    # the member list the client already holds.
    pagination_class = None

    def safely_get_queryset(self, queryset):
        return queryset.filter(organization=self.organization).select_related("user", "handoff_role", "changed_by")

    @extend_schema(responses={200: AgentAvailabilitySerializer(many=True)})
    def list(self, request: Request, **kwargs) -> Response:
        entries = self.get_queryset().order_by("user_id")
        return Response(AgentAvailabilitySerializer(entries, many=True).data)

    # PUT rather than PATCH: the body fully describes the state, and a partial variant would make
    # both fields optional in the generated clients when they're the only things being set.
    @extend_schema(
        request=SetAgentAvailabilitySerializer,
        responses={200: AgentAvailabilityStateSerializer},
    )
    def update(self, request: Request, pk: str | None = None, **kwargs) -> Response:
        target_user_id = self._parse_target_user_id(pk)
        actor = cast(User, request.user)
        self._check_can_set_for(target_user_id, actor)

        serializer = SetAgentAvailabilitySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        is_available = serializer.validated_data["is_available"]
        handoff_role_id = self._validated_handoff_role_id(
            serializer.validated_data.get("handoff_role_id", UNCHANGED_HANDOFF_ROLE)
        )

        changed = set_availability(
            organization=self.organization,
            target_user_id=target_user_id,
            actor=actor,
            is_available=is_available,
            handoff_role_id=handoff_role_id,
        )
        if changed:
            report_user_action(
                actor,
                "support agent availability changed",
                {
                    "is_available": is_available,
                    "is_self": actor.id == target_user_id,
                    "has_handoff_role": handoff_role_id is not None,
                },
                organization=self.organization,
                request=request,
            )

        return Response(
            AgentAvailabilityStateSerializer(
                {
                    "user_id": target_user_id,
                    "is_available": is_available,
                    "handoff_role_id": self._stored_handoff_role_id(target_user_id),
                }
            ).data
        )

    def _parse_target_user_id(self, pk: str | None) -> int:
        try:
            target_user_id = int(pk or "")
        except ValueError:
            raise exceptions.NotFound("Person not found.")

        if not OrganizationMembership.objects.filter(organization=self.organization, user_id=target_user_id).exists():
            raise exceptions.NotFound("Person not found.")
        return target_user_id

    def _check_can_set_for(self, target_user_id: int, actor: User) -> None:
        if actor.id == target_user_id:
            return

        membership = OrganizationMembership.objects.filter(organization=self.organization, user=actor).first()
        if membership is None or membership.level < OrganizationMembership.Level.ADMIN:
            raise exceptions.PermissionDenied(
                "You can only change your own availability. Ask an organization admin to change someone else's."
            )

    def _validated_handoff_role_id(self, handoff_role_id):
        if handoff_role_id is None or isinstance(handoff_role_id, UnchangedHandoffRole):
            return handoff_role_id
        if not Role.objects.filter(id=handoff_role_id, organization=self.organization).exists():
            raise serializers.ValidationError({"handoff_role_id": "This group doesn't belong to your organization."})
        return handoff_role_id

    def _stored_handoff_role_id(self, target_user_id: int) -> str | None:
        """Read the group back, so a request that omitted it still learns what's in force."""
        availability = AgentAvailability.objects.filter(organization=self.organization, user_id=target_user_id).first()
        return str(availability.handoff_role_id) if availability and availability.handoff_role_id else None
