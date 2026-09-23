BEGIN;

ALTER TABLE sync_inbox DROP CONSTRAINT IF EXISTS sync_inbox_event_type_check;
ALTER TABLE sync_inbox ADD CONSTRAINT sync_inbox_event_type_check CHECK (event_type IN (
  'ONLINE_ORDER_CREATED', 'RESERVATION_CREATED',
  'MENU_ITEM_CREATED', 'MENU_ITEM_UPDATED', 'MENU_ITEM_DELETED',
  'CATEGORY_CREATED', 'CATEGORY_UPDATED', 'CATEGORY_DELETED'
));

ALTER TABLE incoming_pos_events DROP CONSTRAINT IF EXISTS incoming_pos_events_event_type_check;
ALTER TABLE incoming_pos_events ALTER COLUMN aggregate_id TYPE TEXT USING aggregate_id::TEXT;
ALTER TABLE online_order_items ALTER COLUMN menu_item_id TYPE TEXT USING menu_item_id::TEXT;
ALTER TABLE incoming_pos_events ADD CONSTRAINT incoming_pos_events_event_type_check CHECK (event_type IN (
  'ONLINE_ORDER_CREATED', 'RESERVATION_CREATED',
  'MENU_ITEM_CREATED', 'MENU_ITEM_UPDATED', 'MENU_ITEM_DELETED',
  'CATEGORY_CREATED', 'CATEGORY_UPDATED', 'CATEGORY_DELETED'
));

CREATE TABLE menu_sync_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID,
  store_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('menu_categories', 'menu_items')),
  entity_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('APPLIED', 'STALE_IGNORED', 'ALREADY_PROCESSED')),
  updated_source TEXT,
  updated_by TEXT,
  version_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_menu_sync_audit_entity ON menu_sync_audit(store_id, entity_type, entity_id, recorded_at DESC);
ALTER TABLE sync_inbox ADD COLUMN IF NOT EXISTS outcome TEXT;

-- The application's real menu repository is repository_records.  Queue its
-- durable JSON records in the same outbox used by all existing POS changes.
CREATE OR REPLACE FUNCTION queue_menu_repository_sync_event() RETURNS TRIGGER AS $$
DECLARE record JSONB; entity TEXT; namespace TEXT; record_id TEXT; store TEXT;
BEGIN
  IF current_setting('restaurant_pos.app_mode', true) IS DISTINCT FROM 'POS'
     OR current_setting('restaurant_pos.sync_origin', true) = 'CLOUD_MANAGER' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    namespace := OLD.namespace;
    record := OLD.payload;
    record_id := OLD.record_key;
  ELSE
    namespace := NEW.namespace;
    record := NEW.payload;
    record_id := NEW.record_key;
  END IF;

  IF namespace NOT IN ('menu:categories', 'menu:items') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  entity := CASE namespace
    WHEN 'menu:categories' THEN 'menu_categories' ELSE 'menu_items' END;
  store := COALESCE(NULLIF(record->>'branchId', ''), current_setting('restaurant_pos.store_id', true), 'default');
  INSERT INTO sync_outbox(store_id, entity_type, entity_id, operation, payload)
  VALUES(store, entity, record_id, CASE WHEN TG_OP = 'DELETE' THEN 'DELETE' ELSE 'UPSERT' END, record);
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS repository_menu_sync_outbox ON repository_records;
CREATE TRIGGER repository_menu_sync_outbox
AFTER INSERT OR UPDATE OR DELETE ON repository_records
FOR EACH ROW
EXECUTE FUNCTION queue_menu_repository_sync_event();

-- Base menu tables are not the application repository and must not emit a
-- second representation of the same logical menu mutation.
DROP TRIGGER IF EXISTS menu_categories_sync_outbox ON menu_categories;
DROP TRIGGER IF EXISTS menu_items_sync_outbox ON menu_items;

COMMIT;
