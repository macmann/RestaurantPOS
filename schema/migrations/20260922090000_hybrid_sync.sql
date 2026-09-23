BEGIN;

CREATE TABLE sync_outbox (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('UPSERT', 'DELETE')),
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'SYNCED', 'FAILED')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at TIMESTAMPTZ,
  last_error TEXT
);
CREATE INDEX idx_sync_outbox_pending ON sync_outbox(status, next_attempt_at, occurred_at);

CREATE TABLE sync_inbox (
  event_id UUID PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type IN ('ONLINE_ORDER_CREATED', 'RESERVATION_CREATED')),
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  last_error TEXT
);

CREATE TABLE processed_sync_events (
  event_id UUID PRIMARY KEY,
  store_id TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE store_sync_status (
  store_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  last_successful_sync_at TIMESTAMPTZ,
  last_pos_activity_at TIMESTAMPTZ,
  last_incoming_poll_at TIMESTAMPTZ,
  pending_event_count INTEGER NOT NULL DEFAULT 0,
  failed_event_count INTEGER NOT NULL DEFAULT 0,
  application_version TEXT,
  last_error TEXT
);

CREATE TYPE online_order_status AS ENUM ('SUBMITTED','RECEIVED_BY_POS','ACCEPTED','REJECTED','PREPARING','READY','COMPLETED','CANCELLED');
CREATE TYPE reservation_status AS ENUM ('REQUESTED','RECEIVED_BY_POS','CONFIRMED','REJECTED','SEATED','COMPLETED','NO_SHOW','CANCELLED');

CREATE TABLE customer_web_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  phone_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE online_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), store_id TEXT NOT NULL,
  customer_id UUID NOT NULL REFERENCES customer_web_accounts(id), customer_name TEXT NOT NULL, customer_phone TEXT NOT NULL,
  requested_pickup_at TIMESTAMPTZ, status online_order_status NOT NULL DEFAULT 'SUBMITTED',
  total NUMERIC(12,2) NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE online_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), online_order_id UUID NOT NULL REFERENCES online_orders(id) ON DELETE CASCADE,
  menu_item_id UUID NOT NULL, name TEXT NOT NULL, quantity NUMERIC(12,3) NOT NULL CHECK(quantity > 0), unit_price NUMERIC(12,2) NOT NULL CHECK(unit_price >= 0)
);
CREATE TABLE reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), store_id TEXT NOT NULL,
  customer_id UUID NOT NULL REFERENCES customer_web_accounts(id), customer_name TEXT NOT NULL, customer_phone TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL, party_size INTEGER NOT NULL CHECK(party_size > 0), notes TEXT,
  status reservation_status NOT NULL DEFAULT 'REQUESTED', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE incoming_pos_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(), store_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('ONLINE_ORDER_CREATED','RESERVATION_CREATED')),
  aggregate_id UUID NOT NULL, payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ, acknowledged_at TIMESTAMPTZ
);
CREATE INDEX idx_incoming_pos_events_delivery ON incoming_pos_events(store_id, acknowledged_at, created_at);

CREATE OR REPLACE FUNCTION queue_pos_sync_event() RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('restaurant_pos.app_mode', true) = 'POS' THEN
    INSERT INTO sync_outbox(store_id, entity_type, entity_id, operation, payload)
    VALUES (COALESCE(current_setting('restaurant_pos.store_id', true), NEW.branch_id::TEXT, OLD.branch_id::TEXT, 'default'),
            TG_TABLE_NAME, COALESCE(NEW.id::TEXT, OLD.id::TEXT), CASE WHEN TG_OP='DELETE' THEN 'DELETE' ELSE 'UPSERT' END,
            CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END);
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$ LANGUAGE plpgsql;

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['branches','roles','users','menu_categories','menu_items','tables','table_sessions','orders','order_items','bills','bill_splits','payments','inventory_items','stock_ledger'] LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('CREATE TRIGGER %I_sync_outbox AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION queue_pos_sync_event()', t, t);
    END IF;
  END LOOP;
END $$;

COMMIT;
