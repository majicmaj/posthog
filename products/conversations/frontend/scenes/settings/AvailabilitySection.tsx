import { useActions, useValues } from 'kea'

import { LemonSelect, LemonSwitch, LemonTable, LemonTag, ProfilePicture, Tooltip } from '@posthog/lemon-ui'

import { TZLabel } from 'lib/components/TZLabel'
import { fullName } from 'lib/utils/strings'
import { membersLogic } from 'scenes/organization/membersLogic'
import { rolesLogic } from 'scenes/settings/organization/Permissions/Roles/rolesLogic'
import { userLogic } from 'scenes/userLogic'

import type { OrganizationMemberType, RoleType } from '~/types'

import { agentAvailabilityLogic } from '../../agentAvailabilityLogic'

const UNASSIGNED_HANDOFF = 'unassigned'

function HandoffRoleSelect({
    value,
    roles,
    onChange,
    disabledReason,
}: {
    value: string | null
    roles: RoleType[]
    onChange: (roleId: string | null) => void
    disabledReason?: string
}): JSX.Element {
    return (
        <LemonSelect
            size="small"
            value={value ?? UNASSIGNED_HANDOFF}
            disabledReason={disabledReason}
            onChange={(next) => onChange(next === UNASSIGNED_HANDOFF ? null : next)}
            options={[
                { value: UNASSIGNED_HANDOFF, label: 'Leave unassigned' },
                ...roles.map((role) => ({ value: role.id, label: role.name })),
            ]}
        />
    )
}

function YourAvailability(): JSX.Element {
    const { user } = useValues(userLogic)
    const { myAvailability, myHandoffRoleId, availabilityLoading } = useValues(agentAvailabilityLogic)
    const { setAgentAvailability } = useActions(agentAvailabilityLogic)
    const { roles, rolesLoading } = useValues(rolesLogic)

    const isAvailable = myAvailability?.is_available ?? true

    return (
        <div className="flex flex-col gap-2">
            <LemonSwitch
                bordered
                fullWidth
                checked={isAvailable}
                disabledReason={!user ? 'Loading' : availabilityLoading ? 'Saving' : undefined}
                onChange={(checked) =>
                    user &&
                    setAgentAvailability({
                        userId: user.id,
                        isAvailable: checked,
                        // Left out when we have no row for them yet, so a toggle before the list
                        // loads can't clear a group we never saw.
                        handoffRoleId: myAvailability ? myHandoffRoleId : undefined,
                    })
                }
                label="Available for new tickets"
            />
            <div className="flex items-center gap-2 justify-between">
                <div>
                    <label className="font-medium">When I'm unavailable, hand my tickets to</label>
                    <p className="text-xs text-secondary mb-0">
                        Your open tickets move to this group so someone who is around picks them up. They don't come
                        back when you're available again.
                    </p>
                </div>
                <HandoffRoleSelect
                    value={myHandoffRoleId}
                    roles={roles ?? []}
                    disabledReason={rolesLoading ? 'Loading groups' : availabilityLoading ? 'Saving' : undefined}
                    onChange={(roleId) =>
                        user &&
                        setAgentAvailability({
                            userId: user.id,
                            isAvailable,
                            handoffRoleId: roleId,
                        })
                    }
                />
            </div>
        </div>
    )
}

function TeamAvailability(): JSX.Element {
    const { user } = useValues(userLogic)
    const { availabilityByUserId, availabilityLoading, canSetOthers } = useValues(agentAvailabilityLogic)
    const { setAgentAvailability } = useActions(agentAvailabilityLogic)
    const { meFirstMembers, membersLoading } = useValues(membersLogic)
    const { roles, rolesLoading } = useValues(rolesLogic)

    return (
        <LemonTable
            loading={membersLoading}
            dataSource={meFirstMembers}
            rowKey={(member) => member.user.id}
            columns={[
                {
                    title: 'Person',
                    render: (_, member: OrganizationMemberType) => (
                        <div className="flex items-center gap-2">
                            <ProfilePicture user={member.user} size="md" />
                            <span className="ph-no-capture">{fullName(member.user)}</span>
                            {member.user.id === user?.id && <span className="text-secondary">(you)</span>}
                        </div>
                    ),
                },
                {
                    title: 'Taking tickets',
                    render: (_, member: OrganizationMemberType) => {
                        const isAvailable = availabilityByUserId[member.user.id]?.is_available ?? true
                        const isSelf = member.user.id === user?.id
                        return (
                            <LemonSwitch
                                checked={isAvailable}
                                disabledReason={
                                    !isSelf && !canSetOthers
                                        ? "Only organization admins can change someone else's availability"
                                        : availabilityLoading
                                          ? 'Saving'
                                          : undefined
                                }
                                onChange={(checked) =>
                                    setAgentAvailability({
                                        userId: member.user.id,
                                        isAvailable: checked,
                                        handoffRoleId: availabilityByUserId[member.user.id]
                                            ? (availabilityByUserId[member.user.id].handoff_role?.id ?? null)
                                            : undefined,
                                    })
                                }
                            />
                        )
                    },
                },
                {
                    title: 'Tickets hand off to',
                    render: (_, member: OrganizationMemberType) => {
                        const entry = availabilityByUserId[member.user.id]
                        const isSelf = member.user.id === user?.id
                        return (
                            <HandoffRoleSelect
                                value={entry?.handoff_role?.id ?? null}
                                roles={roles ?? []}
                                disabledReason={
                                    !isSelf && !canSetOthers
                                        ? "Only organization admins can change someone else's handoff group"
                                        : rolesLoading
                                          ? 'Loading groups'
                                          : availabilityLoading
                                            ? 'Saving'
                                            : undefined
                                }
                                onChange={(roleId) =>
                                    setAgentAvailability({
                                        userId: member.user.id,
                                        isAvailable: entry?.is_available ?? true,
                                        handoffRoleId: roleId,
                                    })
                                }
                            />
                        )
                    },
                },
                {
                    title: 'Last changed',
                    render: (_, member: OrganizationMemberType) => {
                        const entry = availabilityByUserId[member.user.id]
                        if (!entry) {
                            return <span className="text-secondary">Never</span>
                        }
                        return (
                            <div className="flex items-center gap-1">
                                <TZLabel time={entry.updated_at} />
                                {entry.changed_by && entry.changed_by.id !== member.user.id && (
                                    <Tooltip title={`Changed by ${fullName(entry.changed_by)}`}>
                                        <LemonTag type="muted">by an admin</LemonTag>
                                    </Tooltip>
                                )}
                            </div>
                        )
                    },
                },
            ]}
        />
    )
}

export function AvailabilitySection(): JSX.Element {
    return (
        <div className="flex flex-col gap-4">
            <div>
                <h3 className="mb-1">You</h3>
                <YourAvailability />
            </div>
            <div>
                <h3 className="mb-1">Your team</h3>
                <p className="text-xs text-secondary">
                    Unavailable people can't be assigned a ticket, though they can still pick one up themselves.
                    Assigning to a group is unaffected.
                </p>
                <TeamAvailability />
            </div>
        </div>
    )
}
