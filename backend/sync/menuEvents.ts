import type { DatabaseClient } from '../db/client';

/** Queue a cloud menu change in the same transaction as its repository write. */
export const queueMenuEvent = async (client: DatabaseClient, storeId: string, eventType: string, record: any) => {
  const event = await client.query<any>('SELECT gen_random_uuid() event_id');
  const eventId = event.rows[0].event_id;
  record.originatingEventId = eventId;
  const namespace = eventType.startsWith('MENU_ITEM_') ? 'menu:items' : 'menu:categories';
  await client.query('UPDATE repository_records SET payload=$3::jsonb WHERE namespace=$1 AND record_key=$2', [namespace, record.id, JSON.stringify(record)]);
  await client.query('INSERT INTO incoming_pos_events(event_id,store_id,event_type,aggregate_id,payload) VALUES($1,$2,$3,$4,$5)', [eventId, storeId, eventType, record.id, JSON.stringify(record)]);
  return record;
};
