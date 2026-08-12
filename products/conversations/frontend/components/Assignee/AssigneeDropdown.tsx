import { useActions, useValues } from 'kea'

import { IconPlusSmall, IconX } from '@posthog/icons'
import { LemonButton, LemonInput } from '@posthog/lemon-ui'

import { urls } from 'scenes/urls'

import { agentAvailabilityLogic } from '../../agentAvailabilityLogic'
import { AssigneeIconDisplay, AssigneeLabelDisplay } from './AssigneeDisplay'
import { assigneeSelectLogic } from './assigneeSelectLogic'
import { Assignee, TicketAssignee } from './types'

export interface AssigneeDropdownProps {
    assignee: TicketAssignee
    onChange: (assignee: TicketAssignee) => void
    /**
     * Whether picking an unavailable person is blocked. True when assigning a ticket now, which is
     * what the API rejects. False where the choice is a durable rule rather than a live assignment,
     * such as a workflow action: the API exempts automations, so the picker has to as well.
     */
    blockUnavailable?: boolean
}

export function AssigneeDropdown({ assignee, onChange, blockUnavailable = true }: AssigneeDropdownProps): JSX.Element {
    const { search, filteredRoles, otherFilteredMembers, currentUserMember, rolesLoading, membersLoading } =
        useValues(assigneeSelectLogic)
    const { setSearch } = useActions(assigneeSelectLogic)
    const { unavailableUserIds } = useValues(agentAvailabilityLogic)

    return (
        <div className="max-w-100 deprecated-space-y-2">
            <LemonInput type="search" placeholder="Search" autoFocus value={search} onChange={setSearch} fullWidth />
            <ul className="deprecated-space-y-2">
                {assignee && (
                    <li>
                        <LemonButton
                            fullWidth
                            role="menuitem"
                            size="small"
                            icon={<IconX />}
                            onClick={() => onChange(null)}
                        >
                            Remove assignee
                        </LemonButton>
                    </li>
                )}

                {currentUserMember && (
                    <li>
                        <AssigneeItem
                            item={{
                                id: currentUserMember.user.id,
                                type: 'user',
                                user: currentUserMember.user,
                            }}
                            type="user"
                            onSelect={onChange}
                            activeId={assignee?.id}
                            labelSuffix={
                                <span className="text-secondary">
                                    (you)
                                    {unavailableUserIds.has(currentUserMember.user.id) && ' · Unavailable'}
                                </span>
                            }
                        />
                    </li>
                )}

                <Section
                    title="Roles"
                    loading={rolesLoading}
                    search={!!search}
                    type="role"
                    items={filteredRoles.map((role) => ({
                        id: role.id,
                        type: 'role' as const,
                        role: role,
                    }))}
                    onSelect={onChange}
                    activeId={assignee?.id}
                    emptyState={
                        <LemonButton
                            fullWidth
                            size="small"
                            icon={<IconPlusSmall />}
                            to={urls.settings('organization-roles')}
                        >
                            <div className="text-secondary">Create role</div>
                        </LemonButton>
                    }
                />

                {(!!search || membersLoading || otherFilteredMembers.length > 0) && (
                    <Section
                        title="Users"
                        loading={membersLoading}
                        search={!!search}
                        type="user"
                        items={otherFilteredMembers.map((member) => ({
                            id: member.user.id,
                            type: 'user' as const,
                            user: member.user,
                        }))}
                        onSelect={onChange}
                        activeId={assignee?.id}
                        unavailableUserIds={unavailableUserIds}
                        blockUnavailable={blockUnavailable}
                    />
                )}
            </ul>
        </div>
    )
}

const AssigneeItem = ({
    item,
    type,
    onSelect,
    activeId,
    labelSuffix,
    disabledReason,
}: {
    item: Assignee
    type: 'user' | 'role'
    onSelect: (value: TicketAssignee) => void
    activeId?: string | number
    labelSuffix?: JSX.Element
    disabledReason?: string
}): JSX.Element => {
    return (
        <LemonButton
            fullWidth
            role="menuitem"
            size="small"
            icon={<AssigneeIconDisplay assignee={item} />}
            onClick={() => item?.id && onSelect(String(activeId) === String(item.id) ? null : { type, id: item.id })}
            active={String(activeId) === String(item?.id)}
            disabledReason={disabledReason}
        >
            <span className="flex items-center gap-1">
                <AssigneeLabelDisplay assignee={item} />
                {labelSuffix}
            </span>
        </LemonButton>
    )
}

const Section = ({
    loading,
    search,
    type,
    items,
    onSelect,
    activeId,
    emptyState,
    title,
    unavailableUserIds,
    blockUnavailable,
}: {
    title: string
    loading: boolean
    search: boolean
    type: 'user' | 'role'
    items: Assignee[]
    onSelect: (value: TicketAssignee) => void
    activeId?: string | number
    emptyState?: JSX.Element
    /** Whose rows to mark. Roles are never marked: a group is whoever in it responds. */
    unavailableUserIds?: Set<number>
    blockUnavailable?: boolean
}): JSX.Element => {
    return (
        <li>
            <section className="deprecated-space-y-px">
                <h5 className="mx-2 my-0.5">{title}</h5>
                {items.map((item) => {
                    const isUnavailable = item?.type === 'user' && !!unavailableUserIds?.has(item.id as number)
                    return (
                        <li key={item?.id || 'unassigned'}>
                            <AssigneeItem
                                item={item}
                                type={type}
                                onSelect={onSelect}
                                activeId={activeId}
                                disabledReason={
                                    isUnavailable && blockUnavailable ? 'Unavailable for new tickets' : undefined
                                }
                                labelSuffix={
                                    isUnavailable ? <span className="text-secondary">Unavailable</span> : undefined
                                }
                            />
                        </li>
                    )
                })}

                {loading ? (
                    <div className="p-2 text-secondary italic truncate border-t">Loading...</div>
                ) : items.length === 0 ? (
                    search ? (
                        <div className="p-2 text-secondary italic truncate border-t">
                            <span>No matches</span>
                        </div>
                    ) : (
                        <div className="border-t pt-1">{emptyState}</div>
                    )
                ) : null}
            </section>
        </li>
    )
}
