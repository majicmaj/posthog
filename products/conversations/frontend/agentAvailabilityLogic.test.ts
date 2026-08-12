import { MOCK_DEFAULT_USER } from 'lib/api.mock'

import { expectLogic } from 'kea-test-utils'

import { useMocks } from '~/mocks/jest'
import { initKeaTests } from '~/test/init'

import { agentAvailabilityLogic } from './agentAvailabilityLogic'
import type { AgentAvailabilityApi } from './generated/api.schemas'

const ROLE_ID = 'a1b2c3d4-0000-0000-0000-0000000000ff'
const OTHER_USER_ID = 999

function entry(userId: number, isAvailable: boolean, handoffRoleId: string | null = null): AgentAvailabilityApi {
    return {
        user: { id: userId, uuid: `user-${userId}`, email: `agent-${userId}@example.com` },
        is_available: isAvailable,
        handoff_role: handoffRoleId ? { id: handoffRoleId, name: 'Support' } : null,
        changed_by: null,
        updated_at: '2026-01-01T00:00:00Z',
    } as AgentAvailabilityApi
}

describe('agentAvailabilityLogic', () => {
    let logic: ReturnType<typeof agentAvailabilityLogic.build>
    let putBodies: unknown[]

    beforeEach(() => {
        putBodies = []
        useMocks({
            get: {
                '/api/organizations/:organization_id/conversations/availability/': () => [
                    200,
                    // A row saying "available" exists as soon as someone picks a handoff group, so
                    // treating any row as unavailable would make half the team unassignable.
                    [entry(MOCK_DEFAULT_USER.id, true, ROLE_ID), entry(OTHER_USER_ID, false, ROLE_ID)],
                ],
            },
            put: {
                '/api/organizations/:organization_id/conversations/availability/:id': async ({ request }) => {
                    putBodies.push(await request.json())
                    return [200, { user_id: MOCK_DEFAULT_USER.id, is_available: false, handoff_role_id: ROLE_ID }]
                },
            },
        })
        initKeaTests()
        logic = agentAvailabilityLogic()
        logic.mount()
    })

    afterEach(() => {
        logic?.unmount()
    })

    it('counts only people whose row says they are unavailable', async () => {
        await expectLogic(logic).toFinishAllListeners()

        expect(logic.values.unavailableUserIds).toEqual(new Set([OTHER_USER_ID]))
    })

    it('keeps the chosen handoff group when toggling availability', async () => {
        // Sending the group back on every change is what stops a toggle from silently clearing it.
        await expectLogic(logic).toFinishAllListeners()

        logic.actions.setAgentAvailability({
            userId: MOCK_DEFAULT_USER.id,
            isAvailable: false,
            handoffRoleId: logic.values.myHandoffRoleId,
        })
        await expectLogic(logic).toFinishAllListeners()

        expect(putBodies).toEqual([{ is_available: false, handoff_role_id: ROLE_ID }])
    })
})
