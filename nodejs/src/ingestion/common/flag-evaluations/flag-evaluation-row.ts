import { serializeEvent } from '~/ingestion/common/steps/event-processing/emit-event-step'
import { ProcessedEvent, RawKafkaEvent } from '~/types'

/**
 * One row for the kafka_flag_evaluations ClickHouse table (JSONEachRow).
 * Keep in sync with posthog/models/flag_evaluations/sql.py.
 *
 * The table mirrors the events schema, so the row is the events wire format
 * narrowed to exactly the columns the Kafka engine table declares. Going
 * through serializeEvent keeps every shared field byte-identical to what the
 * events table receives for the same event.
 *
 * Deliberately not sent:
 * - `inserted_at`: omitted keys zero-fill in ClickHouse, and the MV treats the
 *   epoch sentinel as "absent" and stamps the Kafka message timestamp instead.
 * - `group0..group4_properties`: the events producer does not send them either
 *   (they are not in RawKafkaEvent); they zero-fill empty in both tables.
 * - `flag_key`, `response`, `session_id`, `request_id`, `$group_0..4`: the
 *   storage table MATERIALIZES these from `properties`; the Kafka table has no
 *   such columns.
 */
export type FlagEvaluationRow = Pick<
    RawKafkaEvent,
    | 'uuid'
    | 'event'
    | 'properties'
    | 'timestamp'
    | 'team_id'
    | 'distinct_id'
    | 'created_at'
    | 'person_id'
    | 'person_properties'
>

export function mapProcessedEventToFlagEvaluationRow(event: ProcessedEvent): FlagEvaluationRow {
    const serialized = serializeEvent(event)
    return {
        uuid: serialized.uuid,
        event: serialized.event,
        properties: serialized.properties,
        timestamp: serialized.timestamp,
        team_id: serialized.team_id,
        distinct_id: serialized.distinct_id,
        created_at: serialized.created_at,
        person_id: serialized.person_id,
        person_properties: serialized.person_properties,
    }
}
