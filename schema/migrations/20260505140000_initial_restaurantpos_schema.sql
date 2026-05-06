BEGIN;

-- Extensions for UUID and case-insensitive text.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- =====================
-- Enums
-- =====================
CREATE TYPE order_status AS ENUM (
  'DRAFT',
  'PLACED',
  'CONFIRMED',
  'IN_PREP',
  'READY',
  'SERVED',
  'COMPLETED',
  'CANCELLED'
);

CREATE TYPE kitchen_ticket_status AS ENUM (
  'NEW',
  'IN_PROGRESS',
  'READY',
  'CANCELLED'
);

CREATE TYPE billing_state AS ENUM (
  'OPEN',
  'PARTIALLY_PAID',
  'PAID',
  'VOID',
  'REFUNDED'
);

CREATE TYPE payment_status AS ENUM (
  'PENDING',
  'AUTHORIZED',
  'CAPTURED',
  'FAILED',
  'VOIDED',
  'REFUNDED'
);

CREATE TYPE payment_method AS ENUM (
  'CASH',
  'CARD',
  'WALLET',
  'BANK_TRANSFER',
  'VOUCHER'
);

CREATE TYPE debt_entry_type AS ENUM (
  'CHARGE',
  'PAYMENT',
  'ADJUSTMENT',
  'WRITE_OFF'
);

CREATE TYPE stock_entry_type AS ENUM (
  'PURCHASE',
  'CONSUMPTION',
  'ADJUSTMENT',
  'WASTE',
  'TRANSFER'
);

CREATE TYPE promo_type AS ENUM (
  'PERCENTAGE',
  'FIXED_AMOUNT'
);

CREATE TYPE tax_mode AS ENUM (
  'TAXABLE',
  'TAX_EXEMPT'
);

-- =====================
-- Core identity & access
-- =====================
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name CITEXT NOT NULL UNIQUE,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID NOT NULL REFERENCES roles(id) ON UPDATE CASCADE,
  email CITEXT NOT NULL UNIQUE,
  username CITEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_role_id ON users(role_id);
CREATE INDEX idx_users_active ON users(is_active);

-- =====================
-- Menu
-- =====================
CREATE TABLE menu_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (name)
);

CREATE TABLE menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES menu_categories(id) ON UPDATE CASCADE,
  sku TEXT UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
  prep_station TEXT,
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (category_id, name)
);

CREATE INDEX idx_menu_items_category_id ON menu_items(category_id);
CREATE INDEX idx_menu_items_available ON menu_items(is_available);

-- =====================
-- Table & session lifecycle
-- =====================
CREATE TABLE tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_code TEXT NOT NULL UNIQUE,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  location_label TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tables_active ON tables(is_active);

CREATE TABLE table_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id UUID NOT NULL REFERENCES tables(id) ON UPDATE CASCADE,
  opened_by_user_id UUID NOT NULL REFERENCES users(id) ON UPDATE CASCADE,
  closed_by_user_id UUID REFERENCES users(id) ON UPDATE CASCADE,
  guest_count INTEGER NOT NULL CHECK (guest_count > 0),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  is_closed BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((is_closed = FALSE AND closed_at IS NULL) OR (is_closed = TRUE AND closed_at IS NOT NULL))
);

CREATE INDEX idx_table_sessions_table_id ON table_sessions(table_id);
CREATE INDEX idx_table_sessions_is_closed ON table_sessions(is_closed);
CREATE INDEX idx_table_sessions_opened_at ON table_sessions(opened_at);

-- Ensure one active session per table.
CREATE UNIQUE INDEX uq_table_sessions_active_per_table
  ON table_sessions(table_id)
  WHERE is_closed = FALSE;

-- =====================
-- Ordering
-- =====================
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_session_id UUID NOT NULL REFERENCES table_sessions(id) ON UPDATE CASCADE,
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON UPDATE CASCADE,
  status order_status NOT NULL DEFAULT 'DRAFT',
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount_total NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  tax_total NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  grand_total NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (grand_total >= 0),
  placed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_orders_table_session_id ON orders(table_session_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created_at ON orders(created_at);

CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON UPDATE CASCADE ON DELETE CASCADE,
  menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON UPDATE CASCADE,
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  item_discount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (item_discount >= 0),
  combo_discount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (combo_discount >= 0),
  happy_hour_discount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (happy_hour_discount >= 0),
  line_discount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (line_discount >= 0),
  line_tax NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (line_tax >= 0),
  line_total NUMERIC(12,2) NOT NULL CHECK (line_total >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_order_items_order_id ON order_items(order_id);
CREATE INDEX idx_order_items_menu_item_id ON order_items(menu_item_id);

CREATE TABLE kitchen_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON UPDATE CASCADE ON DELETE CASCADE,
  status kitchen_ticket_status NOT NULL DEFAULT 'NEW',
  station TEXT,
  fired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  ready_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_kitchen_tickets_order_id ON kitchen_tickets(order_id);
CREATE INDEX idx_kitchen_tickets_status ON kitchen_tickets(status);

-- =====================
-- Billing & payments
-- =====================
CREATE TABLE bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_session_id UUID NOT NULL REFERENCES table_sessions(id) ON UPDATE CASCADE,
  order_id UUID REFERENCES orders(id) ON UPDATE CASCADE,
  state billing_state NOT NULL DEFAULT 'OPEN',
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount_total NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  tax_total NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  tax_mode tax_mode NOT NULL DEFAULT 'TAXABLE',
  tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
  service_charge NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (service_charge >= 0),
  total_due NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_due >= 0),
  amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  calculation_breakdown JSONB NOT NULL DEFAULT '{}'::JSONB,
  receipt_payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bills_table_session_id ON bills(table_session_id);
CREATE INDEX idx_bills_state ON bills(state);

CREATE TABLE bill_splits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id UUID NOT NULL REFERENCES bills(id) ON UPDATE CASCADE ON DELETE CASCADE,
  table_session_id UUID NOT NULL REFERENCES table_sessions(id) ON UPDATE CASCADE,
  split_label TEXT,
  split_ratio NUMERIC(8,5) CHECK (split_ratio > 0),
  split_amount NUMERIC(12,2) NOT NULL CHECK (split_amount >= 0),
  calculation_breakdown JSONB NOT NULL DEFAULT '{}'::JSONB,
  state billing_state NOT NULL DEFAULT 'OPEN',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (split_ratio IS NOT NULL OR split_amount >= 0)
);

CREATE INDEX idx_bill_splits_bill_id ON bill_splits(bill_id);
CREATE INDEX idx_bill_splits_table_session_id ON bill_splits(table_session_id);
CREATE INDEX idx_bill_splits_state ON bill_splits(state);

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id UUID NOT NULL REFERENCES bills(id) ON UPDATE CASCADE,
  bill_split_id UUID REFERENCES bill_splits(id) ON UPDATE CASCADE,
  collected_by_user_id UUID REFERENCES users(id) ON UPDATE CASCADE,
  method payment_method NOT NULL,
  status payment_status NOT NULL DEFAULT 'PENDING',
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  external_ref TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (bill_split_id IS NULL) OR
    (bill_split_id IS NOT NULL)
  )
);

CREATE INDEX idx_payments_bill_id ON payments(bill_id);
CREATE INDEX idx_payments_bill_split_id ON payments(bill_split_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_method ON payments(method);

CREATE TABLE debt_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_session_id UUID REFERENCES table_sessions(id) ON UPDATE CASCADE,
  bill_id UUID REFERENCES bills(id) ON UPDATE CASCADE,
  payment_id UUID REFERENCES payments(id) ON UPDATE CASCADE,
  entry_type debt_entry_type NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  balance_after NUMERIC(12,2) NOT NULL,
  notes TEXT,
  created_by_user_id UUID REFERENCES users(id) ON UPDATE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (amount <> 0)
);

CREATE INDEX idx_debt_ledger_session_id ON debt_ledger(table_session_id);
CREATE INDEX idx_debt_ledger_bill_id ON debt_ledger(bill_id);
CREATE INDEX idx_debt_ledger_payment_id ON debt_ledger(payment_id);
CREATE INDEX idx_debt_ledger_created_at ON debt_ledger(created_at);

-- =====================
-- Inventory
-- =====================
CREATE TABLE inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku TEXT UNIQUE,
  name TEXT NOT NULL UNIQUE,
  unit TEXT NOT NULL,
  reorder_level NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  current_stock NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_inventory_items_active ON inventory_items(is_active);

CREATE TABLE stock_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON UPDATE CASCADE,
  order_item_id UUID REFERENCES order_items(id) ON UPDATE CASCADE,
  entry_type stock_entry_type NOT NULL,
  quantity_change NUMERIC(12,3) NOT NULL,
  stock_after NUMERIC(12,3) NOT NULL CHECK (stock_after >= 0),
  reason TEXT,
  created_by_user_id UUID REFERENCES users(id) ON UPDATE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (quantity_change <> 0)
);

CREATE INDEX idx_stock_ledger_inventory_item_id ON stock_ledger(inventory_item_id);
CREATE INDEX idx_stock_ledger_order_item_id ON stock_ledger(order_item_id);
CREATE INDEX idx_stock_ledger_entry_type ON stock_ledger(entry_type);
CREATE INDEX idx_stock_ledger_created_at ON stock_ledger(created_at);

-- =====================
-- Promotions
-- =====================
CREATE TABLE promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  promo_type promo_type NOT NULL,
  value NUMERIC(12,2) NOT NULL CHECK (value > 0),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  min_order_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (min_order_amount >= 0),
  max_discount NUMERIC(12,2) CHECK (max_discount >= 0),
  usage_limit INTEGER CHECK (usage_limit > 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  precedence INTEGER NOT NULL DEFAULT 4 CHECK (precedence > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at IS NULL OR ends_at >= starts_at)
);

CREATE INDEX idx_promotions_active ON promotions(is_active);
CREATE INDEX idx_promotions_starts_at ON promotions(starts_at);
CREATE INDEX idx_promotions_ends_at ON promotions(ends_at);

-- =====================
-- Auditing
-- =====================
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(id) ON UPDATE CASCADE,
  actor_role TEXT,
  action TEXT NOT NULL,
  entity_name TEXT NOT NULL,
  entity_id UUID,
  reason TEXT,
  before_snapshot JSONB,
  after_snapshot JSONB,
  request_id TEXT,
  ip_address INET,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_actor_user_id ON audit_logs(actor_user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_name, entity_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX idx_audit_logs_metadata_gin ON audit_logs USING GIN (metadata);

COMMIT;
