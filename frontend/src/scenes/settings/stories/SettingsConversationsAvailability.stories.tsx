import {
    MOCK_DEFAULT_ORGANIZATION,
    MOCK_DEFAULT_ORGANIZATION_MEMBER,
    MOCK_DEFAULT_USER,
    MOCK_SECOND_ORGANIZATION_MEMBER,
} from 'lib/api.mock'

import type { Meta, StoryObj } from '@storybook/react'

import { mswDecorator } from '~/mocks/browser'
import preflightJson from '~/mocks/fixtures/_preflight.json'

import { AssigneeDropdown } from 'products/conversations/frontend/components/Assignee/AssigneeDropdown'
import { AvailabilitySection } from 'products/conversations/frontend/scenes/settings/AvailabilitySection'

const SUPPORT_ROLE = { id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Team support' }
const ENGINEERING_ROLE = { id: 'aaaaaaaa-0000-0000-0000-000000000002', name: 'Engineering' }

const meta: Meta<typeof AvailabilitySection> = {
    title: 'Scenes-App/Settings/Conversations availability',
    component: AvailabilitySection,
    parameters: { viewMode: 'story', mockDate: '2026-08-12T18:00:00' },
    decorators: [
        mswDecorator({
            get: {
                '/_preflight': { ...preflightJson, cloud: true, realm: 'cloud' },
                // Line the signed-in user up with the first member so "your availability" reads
                // that member's row.
                '/api/users/@me/': {
                    ...MOCK_DEFAULT_USER,
                    id: MOCK_DEFAULT_ORGANIZATION_MEMBER.user.id,
                    organization: MOCK_DEFAULT_ORGANIZATION,
                },
                '/api/organizations/:organization_id/roles/': {
                    count: 2,
                    results: [
                        { ...SUPPORT_ROLE, created_at: '2026-01-01T00:00:00Z', created_by: null, members: [] },
                        { ...ENGINEERING_ROLE, created_at: '2026-01-01T00:00:00Z', created_by: null, members: [] },
                    ],
                },
                '/api/organizations/:organization_id/members/': {
                    count: 2,
                    results: [MOCK_DEFAULT_ORGANIZATION_MEMBER, MOCK_SECOND_ORGANIZATION_MEMBER],
                },
                '/api/organizations/:organization_id/conversations/availability/': [
                    {
                        user: MOCK_DEFAULT_ORGANIZATION_MEMBER.user,
                        is_available: true,
                        handoff_role: SUPPORT_ROLE,
                        changed_by: null,
                        updated_at: '2026-08-11T09:30:00Z',
                    },
                    {
                        user: MOCK_SECOND_ORGANIZATION_MEMBER.user,
                        is_available: false,
                        handoff_role: ENGINEERING_ROLE,
                        changed_by: MOCK_DEFAULT_USER,
                        updated_at: '2026-08-12T08:00:00Z',
                    },
                ],
            },
        }),
    ],
}
export default meta

export const ConversationsAvailability: StoryObj<typeof AvailabilitySection> = {}

/** The assignee picker marks whoever is away and stops them being chosen. */
export const AssigneePicker: StoryObj<typeof AvailabilitySection> = {
    render: () => (
        <div className="w-80 border rounded p-2 bg-surface-primary">
            <AssigneeDropdown assignee={null} onChange={() => {}} />
        </div>
    ),
}
