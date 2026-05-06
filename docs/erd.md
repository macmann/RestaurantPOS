# RestaurantPOS ERD

This ERD documents the initial relational schema in `schema/migrations/20260505140000_initial_restaurantpos_schema.sql`.

## Entity Relationship Overview

- `Role (1) -> (N) User`
- `User (1) -> (N) TableSession` (opened/closed by)
- `MenuCategory (1) -> (N) MenuItem`
- `Table (1) -> (N) TableSession`
- `TableSession (1) -> (N) Order`
- `Order (1) -> (N) OrderItem`
- `Order (1) -> (N) KitchenTicket`
- `TableSession (1) -> (N) Bill`
- `Bill (1) -> (N) BillSplit`
- `Bill (1) -> (N) Payment`
- `BillSplit (0..1) <- (N) Payment`
- `InventoryItem (1) -> (N) StockLedger`
- `OrderItem (0..1) -> (N) StockLedger`
- `Bill / Payment / TableSession -> DebtLedger` (optional references per entry)
- `User (0..1) -> (N) AuditLog`

## Key Tables and Constraints

## 1) Identity and Access

### `roles`
- Unique role names via `name` (`CITEXT`) for case-insensitive uniqueness.

### `users`
- Every user must belong to one `role` (`role_id` NOT NULL).
- `email` and `username` are both globally unique (case-insensitive).

## 2) Menu

### `menu_categories`
- Category names are unique.

### `menu_items`
- Every item belongs to one category (`category_id` NOT NULL).
- `UNIQUE(category_id, name)` prevents duplicate item names within a category.
- `price` and `tax_rate` have non-negative checks.

## 3) Dine-in Session Model

### `tables`
- Each physical table has unique `table_code`.

### `table_sessions`
- One active session per table enforced by partial unique index:
  - `UNIQUE(table_id) WHERE is_closed = FALSE`.
- Temporal integrity check:
  - open session must have `closed_at IS NULL`
  - closed session must have `closed_at IS NOT NULL`.

## 4) Order Lifecycle

### `orders`
- Status enum: `DRAFT`, `PLACED`, `CONFIRMED`, `IN_PREP`, `READY`, `SERVED`, `COMPLETED`, `CANCELLED`.
- Every order belongs to one `table_session` and is created by one `user`.
- Monetary aggregates (`subtotal`, `tax_total`, `grand_total`) are constrained non-negative.

### `order_items`
- Cascades on order delete (`ON DELETE CASCADE`) so orphan line items cannot remain.
- Quantity must be positive.
- Discount columns separate item-level, combo, and happy-hour adjustments before the legacy aggregate `line_discount` for auditability.

### `kitchen_tickets`
- Ticket status enum supports kitchen flow: `NEW`, `IN_PROGRESS`, `READY`, `CANCELLED`.
- Cascades on order delete to keep KDS data aligned.

## 5) Billing, Split Bills, and Payments

### `bills`
- Billing state enum: `OPEN`, `PARTIALLY_PAID`, `PAID`, `VOID`, `REFUNDED`.
- A bill belongs to one `table_session`; it may optionally reference a specific `order`.
- Bill-level tax uses `tax_mode` (`TAXABLE` or `TAX_EXEMPT`) plus `tax_rate` so tax can be toggled without changing line items.
- `calculation_breakdown` and `receipt_payload` store the final calculation path printed on receipts.

### `bill_splits`
- **Important constraint:** each split is explicitly tied to exactly one `bill` **and** one `table_session`.
- This allows enforcing “split bills tied to one table session” at the row level.
- Split rows carry their own billing state using the same billing enum.
- Split-level `calculation_breakdown` records allocated bill-level discounts and tax so split totals reconcile to the full bill.

### `payments`
- Payment status enum: `PENDING`, `AUTHORIZED`, `CAPTURED`, `FAILED`, `VOIDED`, `REFUNDED`.
- Method enum: `CASH`, `CARD`, `WALLET`, `BANK_TRANSFER`, `VOUCHER`.
- Payment can be posted to a full bill or to a split (`bill_split_id` optional).

### `debt_ledger`
- Immutable-style financial ledger entries with typed movements:
  - `CHARGE`, `PAYMENT`, `ADJUSTMENT`, `WRITE_OFF`.
- Each entry can reference `table_session`, `bill`, and `payment` for traceability.

## 6) Inventory

### `inventory_items`
- Inventory entities are uniquely identified by `name` and optional unique `sku`.

### `stock_ledger`
- Ledger-style stock movement with enum types:
  - `PURCHASE`, `CONSUMPTION`, `ADJUSTMENT`, `WASTE`, `TRANSFER`.
- Optional `order_item_id` supports consumption links from kitchen/orders.

## 7) Promotions

### `promotions`
- Promotion code is unique.
- Supports percentage/fixed amount via enum `promo_type`.
- `precedence` documents where a promotion participates in the enforced discount order; bill-level promotions use precedence 4 after item, combo, and happy-hour discounts.
- Validity window check ensures `ends_at >= starts_at` when present.

## 8) Audit

### `audit_logs`
- Generic audit trail table with actor, role, action, entity target, timestamp, reason, before/after JSON snapshots, and metadata.
- Used for sensitive events including login success/failure, order edits/cancellations, bill voids, stock movements, tax toggles, discounts, and debt creation/settlement.
- Indexed by actor, action, target (`entity_name`, `entity_id`), event time, and metadata search support.

## Indexing Strategy Highlights

- Foreign keys are paired with indexes on all high-cardinality join columns.
- Status columns (`orders.status`, `bills.state`, `payments.status`, `kitchen_tickets.status`) are indexed for dashboard/queue filters.
- Time-oriented indexes (`created_at`, `opened_at`) support reporting and timeline queries.

## Notes for Application-layer Enforcement

Some cross-table invariants are best enforced in service logic or triggers, for example:
- ensuring a `bill_split.table_session_id` always matches `bills.table_session_id` for the referenced bill,
- ensuring `payments.bill_split_id` (if set) belongs to the same `bill_id`,
- ensuring totals reconcile (`sum(order_items.line_total)` vs `orders.grand_total`, split sums vs bill total).
