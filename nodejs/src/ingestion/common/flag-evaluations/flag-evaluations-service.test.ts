import { FlagEvaluationsEnvConfig, createFlagEvaluationsService } from './flag-evaluations-service'

describe('FlagEvaluationsService', () => {
    const envConfig = (mode: string, teams = '*', excludedTeams = ''): FlagEvaluationsEnvConfig => ({
        INGESTION_FLAG_EVALUATIONS_MODE: mode,
        INGESTION_FLAG_EVALUATIONS_TEAMS: teams,
        INGESTION_FLAG_EVALUATIONS_EXCLUDED_TEAMS: excludedTeams,
    })

    describe('createFlagEvaluationsService', () => {
        it('returns undefined when disabled', () => {
            expect(createFlagEvaluationsService(envConfig('disabled'))).toBeUndefined()
        })

        it('returns undefined when mode is invalid (falls back to disabled)', () => {
            expect(createFlagEvaluationsService(envConfig('garbage'))).toBeUndefined()
        })

        it('returns undefined when excluded teams is wildcard', () => {
            // The escape hatch on a shadow-routing feature must fail toward the
            // events table, not toward excluding everyone from being excluded.
            expect(createFlagEvaluationsService(envConfig('dual_write', '*', '*'))).toBeUndefined()
        })

        it('returns a service otherwise', () => {
            expect(createFlagEvaluationsService(envConfig('dual_write'))).toBeDefined()
        })
    })

    describe('isEnabledForTeam', () => {
        it.each([
            ['*', '', 5, true],
            ['*', '5', 5, false],
            ['1,2', '', 2, true],
            ['1,2', '', 3, false],
            ['1,2', '2', 2, false],
            ['', '', 1, false],
        ])('teams=%s excluded=%s team=%i -> %s', (teams, excluded, teamId, expected) => {
            const service = createFlagEvaluationsService(envConfig('dual_write', teams, excluded))

            expect(service?.isEnabledForTeam(teamId)).toBe(expected)
        })
    })
})
