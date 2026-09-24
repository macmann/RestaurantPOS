BEGIN;

-- The original bidirectional-menu migration was corrected after some
-- deployments had already recorded it as applied.  Migrations are immutable,
-- so install the corrected function and trigger under a new migration id to
-- repair those databases as well as new installations.
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
  store := COALESCE(NULLIF(record->>'branchId', ''), NULLIF(current_setting('restaurant_pos.store_id', true), ''), 'default');
  INSERT INTO sync_outbox(store_id, entity_type, entity_id, operation, payload)
  VALUES(store, entity, record_id, CASE WHEN TG_OP = 'DELETE' THEN 'DELETE' ELSE 'UPSERT' END, record);
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS repository_menu_sync_outbox ON repository_records;
CREATE TRIGGER repository_menu_sync_outbox
AFTER INSERT OR UPDATE OR DELETE ON repository_records
FOR EACH ROW
EXECUTE FUNCTION queue_menu_repository_sync_event();

-- repository_records is the actual application menu store.  Retaining the
-- legacy table triggers would enqueue a second representation of a mutation.
DROP TRIGGER IF EXISTS menu_categories_sync_outbox ON menu_categories;
DROP TRIGGER IF EXISTS menu_items_sync_outbox ON menu_items;

COMMIT;
