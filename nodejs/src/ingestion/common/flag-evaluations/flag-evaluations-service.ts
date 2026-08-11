import { parseTeamsList } from '~/common/utils/env-utils'
import { logger } from '~/common/utils/logger'
import { IngestionConsumerConfig } from '~/ingestion/config'

const FLAG_EVALUATIONS_MODES = ['disabled', 'dual_write'] as const

export type FlagEvaluationsMode = (typeof FLAG_EVALUATIONS_MODES)[number]

function isFlagEvaluationsMode(mode: string): mode is FlagEvaluationsMode {
    return (FLAG_EVALUATIONS_MODES as readonly string[]).includes(mode)
}

export interface FlagEvaluationsConfig {
    mode: FlagEvaluationsMode
    /** '*' for all teams, or an explicit allowlist of team IDs. */
    teams: number[] | '*'
    /** Escape hatch: teams never forked, even when `teams` is '*'. */
    excludedTeams: number[]
}

function parseFlagEvaluationsConfig(mode: string, teams: string, excludedTeams: string): FlagEvaluationsConfig {
    let parsedMode: FlagEvaluationsMode = 'disabled'
    if (isFlagEvaluationsMode(mode)) {
        parsedMode = mode
    } else {
        logger.warn('Invalid INGESTION_FLAG_EVALUATIONS_MODE, falling back to disabled', { mode })
    }
    const excluded = parseTeamsList(excludedTeams)
    if (excluded === '*') {
        // An operator reaching for '*' as an exclude-everyone switch means "off".
        logger.warn('INGESTION_FLAG_EVALUATIONS_EXCLUDED_TEAMS is "*", disabling the flag evaluations fork')
        parsedMode = 'disabled'
    }
    return {
        mode: parsedMode,
        teams: parseTeamsList(teams),
        excludedTeams: excluded === '*' ? [] : excluded,
    }
}

/**
 * Gate for the $feature_flag_called fork that shadow-writes flag evaluations to
 * the ClickHouse flag_evaluations table (via the clickhouse_flag_evaluations
 * topic) while the event continues to the events table unchanged.
 *
 * `dual_write` is the only active mode for now; a `route` mode (dropping forked
 * events from the events path) is planned on this same switch once the
 * experiment carve-out signal is settled. Every failure path in the fork
 * continues toward the events table — the shadow write is never load-bearing
 * for an individual event. The produce ack still gates offset commits with the
 * rest of the batch, so a flag_evaluations topic outage stalls the consumer
 * like an events-topic outage would; set the mode to disabled to shed that
 * dependency during an incident.
 *
 * There is no lane gating in code: rollout is per-lane env config. Recommended
 * order is realtime lanes first; the historical lane can stay disabled, since
 * pre-dual-write history is the backfill's job.
 *
 * TODO: the mode/teams/excludedTeams gate duplicates
 * feature-flag-called-dedup-service.ts — extract a shared helper when a third
 * team-gated service needs this shape.
 */
export class FlagEvaluationsService {
    private teams: Set<number> | '*'
    private excludedTeams: Set<number>

    constructor(config: FlagEvaluationsConfig) {
        this.teams = config.teams === '*' ? '*' : new Set(config.teams)
        this.excludedTeams = new Set(config.excludedTeams)
    }

    isEnabledForTeam(teamId: number): boolean {
        if (this.excludedTeams.has(teamId)) {
            return false
        }
        return this.teams === '*' || this.teams.has(teamId)
    }
}

export type FlagEvaluationsEnvConfig = Pick<
    IngestionConsumerConfig,
    'INGESTION_FLAG_EVALUATIONS_MODE' | 'INGESTION_FLAG_EVALUATIONS_TEAMS' | 'INGESTION_FLAG_EVALUATIONS_EXCLUDED_TEAMS'
>

/**
 * Builds the flag evaluations service from ingestion config, or undefined when
 * the fork is disabled (the pipeline step treats an absent service as a
 * passthrough).
 */
export function createFlagEvaluationsService(envConfig: FlagEvaluationsEnvConfig): FlagEvaluationsService | undefined {
    const config = parseFlagEvaluationsConfig(
        envConfig.INGESTION_FLAG_EVALUATIONS_MODE,
        envConfig.INGESTION_FLAG_EVALUATIONS_TEAMS,
        envConfig.INGESTION_FLAG_EVALUATIONS_EXCLUDED_TEAMS
    )
    if (config.mode === 'disabled') {
        return undefined
    }
    return new FlagEvaluationsService(config)
}
