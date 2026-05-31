# End-to-End POS Readiness Checklist

This checklist maps the current SYM POS backend services, frontend view models, and verification coverage to the minimum end-to-end restaurant POS needs.

## Covered operational flows

| POS need | Backend coverage | Frontend/component coverage | Automated verification |
|---|---|---|---|
| Role-gated users and active/inactive status | Auth policies and route middleware enforce active users and action permissions. | Test users represent manager, waiter, kitchen, and cashier stations. | `tests/e2e-pos-flow.test.ts` seeds all station roles before exercising the flow. |
| Menu setup | Menu service creates categories and priced, available menu items. | Admin menu dashboard loads configured categories and items. | E2E test creates a category/item and asserts the admin dashboard can render it. |
| Inventory stock control | Inventory service creates master stock items, stock movements, low-stock alerts, and auto-deduct policy. | Admin inventory alerts view loads current policy and threshold breaches. | E2E test creates stock, transitions an order into preparation, and verifies stock deduction/reporting. |
| Order capture and edits | Orders service supports dine-in/takeout creation, optimistic edit versioning, subtotal recalculation, status transitions, cancellation, audit events, and KDS sync. | Order screen loads localized order state for waitstaff. | E2E test creates, edits, advances, completes, and delivers an order. |
| Kitchen/bar fulfillment | KDS service snapshots station queues, updates item progress, and emits subscriber events. | Kitchen/bar screens load station-specific queues and update progress. | E2E test asserts kitchen ticket visibility and marks the ticket ready. |
| Billing, discounts, tax, receipts, and payment | Billing service handles splits, discount precedence, bill-level tax mode, promotions, receipts, payments, debt ledger, and audit entries. | Billing screen exposes tax toggle, calculation breakdown, receipt preview, and locale switch state. | E2E test generates a bill with item/combo/bill discounts plus tax, records full payment, and verifies zero receipt balance. |
| Reports | Reports service exports sales, inventory usage, and financial summaries with locale-aware print metadata. | Report APIs are available through manager-facing backend controller. | E2E test validates sales, inventory usage, and financial report summaries. |
| Audit trail | Audit service records/searches security, order, billing, debt, stock, tax, and discount events. | Admin audit viewer builds filters and rows for operations review. | E2E test queries the audit API/viewer for the edited order. |
| LAN/offline resilience settings | Branch runtime settings and reconnect policy define local network behavior. | Frontend reconnect policy distinguishes safe reads from unsafe writes. | Covered by TypeScript compilation; add browser/device integration tests before production rollout. |

## Verification commands

- `npm run typecheck` validates all backend, frontend, shared, and test TypeScript files.
- `npm run test:e2e` compiles the project and runs the in-memory end-to-end POS smoke flow.

## Remaining production hardening before live deployment

- Replace in-memory repositories with the SQL schema in `schema/migrations/20260505140000_initial_restaurantpos_schema.sql` and transactionally persist orders, bills, stock movements, and audit entries.
- Add HTTP/WebSocket route adapters around the existing service/controller boundaries.
- Add hardware integrations for receipt printers, cash drawers, barcode scanners, and kitchen display devices.
- Add browser-level UI tests once concrete screens are connected to these view models.
- Add deployment checks for database backups, LAN terminal discovery, TLS/auth session storage, and printer font availability for Burmese receipts.
