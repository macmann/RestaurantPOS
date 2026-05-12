# MVP Acceptance Criteria

This document translates the BRD functional areas into testable MVP acceptance criteria. Each criterion is written in Given/When/Then form and mapped to the accountable module owner and target release milestone.

## Release milestones

| Milestone | Goal |
|---|---|
| **M1 - Core POS Setup** | Staff access, branch configuration, menu setup, table/session foundations, and LAN-ready client behavior. |
| **M2 - Service & Fulfillment** | Order entry, dine-in/takeout lifecycle, kitchen/bar display synchronization, and waiter progress visibility. |
| **M3 - Billing & Stock Control** | Bill calculation, split and partial payments, debt handling, inventory adjustments, low-stock alerts, and receipts. |
| **M4 - Management & Compliance** | Reporting, audit visibility, user lifecycle administration, localization hardening, and operational exception controls. |

## Module owner map

| Functional area | Module owner | Primary modules |
|---|---|---|
| Identity, access, and user lifecycle | Auth & Staff Platform | `backend/auth`, `backend/users`, `frontend/admin` |
| Branch, table, and store settings | Store Operations Platform | `backend/config`, schema settings/tables, admin settings UI |
| Menu catalog, pricing setup, and availability | Menu Management | `backend/menu`, `frontend/admin/menu-management` |
| Order entry and table service | Order Management | `backend/orders`, `frontend/orders`, `frontend/waiter` |
| Kitchen display and prep workflow | KDS Operations | `backend/kds`, `frontend/kds`, `frontend/waiter` |
| Billing, payments, split bills, tax, receipts, and debt | Billing & Payments | `backend/billing`, `frontend/billing` |
| Inventory, stock ledger, and low-stock alerts | Inventory Control | `backend/inventory`, `frontend/admin/inventory-alerts` |
| Reports and dashboards | Reporting & Analytics | `backend/reports` |
| Audit trail and compliance review | Audit & Compliance | `backend/audit`, `frontend/admin/audit-viewer` |
| Localization and LAN resilience | Client Platform | `backend/i18n`, `frontend/i18n`, `frontend/network` |

## Functional-area acceptance criteria

| ID | BRD functional area | Given | When | Then | Module owner | Target milestone |
|---|---|---|---|---|---|---|
| AC-AUTH-01 | Identity, access, and user lifecycle | An active staff user exists with at least one assigned role | The user signs in with valid credentials | The system creates an authenticated session and exposes only the permissions granted by the user's role | Auth & Staff Platform | M1 - Core POS Setup |
| AC-AUTH-02 | Identity, access, and user lifecycle | A staff user is inactive | The user attempts to sign in or calls an authenticated endpoint with an existing session | The request is rejected and no POS action is performed | Auth & Staff Platform | M1 - Core POS Setup |
| AC-AUTH-03 | Identity, access, and user lifecycle | A cashier attempts a manager-only action such as viewing reports or audit logs | The restricted route is requested | The system returns an authorization failure and records no business-state change | Auth & Staff Platform | M1 - Core POS Setup |
| AC-USERS-01 | Identity, access, and user lifecycle | An admin is authenticated | The admin creates, edits, activates, deactivates, or assigns a role to a staff profile | The staff profile is persisted with the requested status and role, and the privileged change is audit-ready | Auth & Staff Platform | M4 - Management & Compliance |
| AC-SETTINGS-01 | Branch, table, and store settings | A manager or admin configures branch timezone, currency, locale, and tax defaults | POS clients load store configuration | Screens and calculations use the active branch settings consistently | Store Operations Platform | M1 - Core POS Setup |
| AC-SETTINGS-02 | Branch, table, and store settings | A table is active and has no open table session | A cashier starts a dine-in session with a guest count | A single open session is created for that table and duplicate open sessions are prevented | Store Operations Platform | M1 - Core POS Setup |
| AC-SETTINGS-03 | Branch, table, and store settings | A table session has unpaid or incomplete orders | A user attempts to close the session | The system blocks closure until all linked orders and bills meet the configured completion rules | Store Operations Platform | M3 - Billing & Stock Control |
| AC-MENU-01 | Menu catalog, pricing setup, and availability | A manager maintains categories, menu items, prices, prep stations, and availability flags | POS clients request the menu | Only active, available items are displayed with current prices and station routing metadata | Menu Management | M1 - Core POS Setup |
| AC-MENU-02 | Menu catalog, pricing setup, and availability | An item is marked unavailable or outside its availability rules | A cashier searches or adds the item to an order | The item cannot be added unless an authorized override is implemented and captured | Menu Management | M2 - Service & Fulfillment |
| AC-MENU-03 | Menu catalog, pricing setup, and availability | Discounts, promotions, and tax behavior are configured | Billing calculates an order or split | Discounts apply in the required precedence order, caps are enforced, and the calculation breakdown is exposed | Menu Management | M3 - Billing & Stock Control |
| AC-ORDER-01 | Order entry and table service | A cashier has order-create permission and an open dine-in or takeout context | The cashier adds items, quantities, modifiers/notes, and saves the order | The order draft is persisted with correct line totals and an editable status before payment | Order Management | M2 - Service & Fulfillment |
| AC-ORDER-02 | Order entry and table service | An order is open and unpaid | The cashier edits quantities, notes, or items | The system updates the order version, recalculates totals, and prevents stale concurrent updates | Order Management | M2 - Service & Fulfillment |
| AC-ORDER-03 | Order entry and table service | An order has been placed | The user advances it through service statuses | Only valid status transitions are accepted, timestamps are captured, and invalid regressions are rejected | Order Management | M2 - Service & Fulfillment |
| AC-ORDER-04 | Order entry and table service | A sensitive order edit or cancellation is requested | The acting role lacks permission or required reason | The system blocks the action or requires authorized approval and creates an audit event when completed | Order Management | M4 - Management & Compliance |
| AC-KDS-01 | Kitchen display and prep workflow | A placed order contains items assigned to kitchen and/or bar stations | The order is fired | Station queues show the correct tickets and item notes without exposing unrelated station work | KDS Operations | M2 - Service & Fulfillment |
| AC-KDS-02 | Kitchen display and prep workflow | A KDS operator changes an item from new to preparing or ready | The update is saved | The station queue, waiter progress screen, and order fulfillment state refresh with the new status | KDS Operations | M2 - Service & Fulfillment |
| AC-KDS-03 | Kitchen display and prep workflow | Network connectivity is briefly interrupted on a KDS screen | Connectivity returns | The queue resynchronizes without duplicating ticket updates or losing the latest status | KDS Operations | M2 - Service & Fulfillment |
| AC-BILL-01 | Billing, payments, split bills, tax, receipts, and debt | An order is ready for checkout | A cashier opens or refreshes the bill | The bill displays subtotal, discounts, taxable subtotal, tax, service charges, total due, amount paid, and balance due | Billing & Payments | M3 - Billing & Stock Control |
| AC-BILL-02 | Billing, payments, split bills, tax, receipts, and debt | A bill is eligible for split billing | A cashier splits by equal ratio, custom amount, or selected items | Split totals reconcile exactly to the parent bill total and each split has its own payment state | Billing & Payments | M3 - Billing & Stock Control |
| AC-BILL-03 | Billing, payments, split bills, tax, receipts, and debt | A cashier records a payment for a bill or split | The tender amount is captured by cash, card, wallet, bank transfer, or voucher | Payment status, amount paid, balance due, receipt payload, and bill state are updated atomically | Billing & Payments | M3 - Billing & Stock Control |
| AC-BILL-04 | Billing, payments, split bills, tax, receipts, and debt | A guest cannot pay the full balance and the role has debt permission | The cashier posts a partial payment and marks the remaining balance as debt | The captured payment is recorded, the debt ledger balance is created for the remainder, and the bill is no longer treated as open receivable at the table | Billing & Payments | M3 - Billing & Stock Control |
| AC-BILL-05 | Billing, payments, split bills, tax, receipts, and debt | A tax mode or discount is changed | Billing recalculates the bill | The calculation breakdown and receipt payload match the on-screen totals and the sensitive change is audit logged | Billing & Payments | M3 - Billing & Stock Control |
| AC-INVENTORY-01 | Inventory, stock ledger, and low-stock alerts | Inventory items have units, current stock, and reorder levels | Stock is purchased, consumed, wasted, transferred, or adjusted | A stock ledger entry is recorded, current stock is recalculated, and negative stock is prevented unless an approved policy allows it | Inventory Control | M3 - Billing & Stock Control |
| AC-INVENTORY-02 | Inventory, stock ledger, and low-stock alerts | Order items map to tracked inventory consumption | An order is completed or otherwise reaches the configured deduction trigger | The system deducts ingredient/product usage exactly once and links consumption entries to the order item | Inventory Control | M3 - Billing & Stock Control |
| AC-INVENTORY-03 | Inventory, stock ledger, and low-stock alerts | Current stock is at or below the reorder level | Inventory alerts are viewed or refreshed | The low-stock item appears with item name, current stock, unit, reorder level, and action state | Inventory Control | M3 - Billing & Stock Control |
| AC-REPORTS-01 | Reports and dashboards | A manager is authenticated | The manager requests sales, payment, debt, inventory, or operational reports for a date range | The report returns branch-scoped totals derived from closed transactions and stock/debt ledgers | Reporting & Analytics | M4 - Management & Compliance |
| AC-REPORTS-02 | Reports and dashboards | A non-manager attempts to view reports | The report endpoint or screen is opened | Access is denied and no report data is returned | Reporting & Analytics | M4 - Management & Compliance |
| AC-AUDIT-01 | Audit trail and compliance review | A sensitive event occurs, including login failure, order edit, bill void, stock adjustment, tax toggle, discount, debt creation, or debt settlement | The action is completed or rejected according to policy | An immutable audit entry captures actor, action, entity, timestamp, before/after data where applicable, and reason when required | Audit & Compliance | M4 - Management & Compliance |
| AC-AUDIT-02 | Audit trail and compliance review | A manager or admin searches audit records | Filters such as action, actor, entity, date range, text query, or reason are supplied | Matching audit events are returned newest-first with available filter options | Audit & Compliance | M4 - Management & Compliance |
| AC-I18N-01 | Localization and LAN resilience | The restaurant uses a supported locale | A user switches locale or opens a localized screen | Labels, screen titles, currency/number conventions, and Unicode text render correctly | Client Platform | M1 - Core POS Setup |
| AC-LAN-01 | Localization and LAN resilience | The WAN is unavailable but the local network and POS server are reachable | Staff perform login, menu lookup, order entry, KDS updates, payment capture, and receipt generation | Core in-store workflows continue over LAN without requiring internet connectivity | Client Platform | M1 - Core POS Setup |
| AC-LAN-02 | Localization and LAN resilience | A client loses connection during a read or retry-safe write | The reconnect policy runs | Safe operations retry within configured limits, unsafe writes are not duplicated, and the user receives a clear recovery state | Client Platform | M2 - Service & Fulfillment |

## End-to-end MVP scenarios

### E2E-01: Dine-in full cycle

| Step | Given | When | Then | Owner | Milestone |
|---|---|---|---|---|---|
| 1 | A cashier is signed in and Table 12 is active with no open session | The cashier starts a dine-in session for four guests | The table session opens and Table 12 is marked occupied | Store Operations Platform | M1 - Core POS Setup |
| 2 | The dine-in session is open and the current menu is loaded | The cashier adds food and drink items with notes and places the order | The order moves from draft to placed, totals calculate, and station tickets are created | Order Management | M2 - Service & Fulfillment |
| 3 | Kitchen and bar tickets exist | KDS operators mark items preparing and ready | Waiter progress updates show the same item states as the station queues | KDS Operations | M2 - Service & Fulfillment |
| 4 | All ordered items are served | The cashier opens checkout | The bill shows itemized totals, discounts, taxes, service charges, and the final amount due | Billing & Payments | M3 - Billing & Stock Control |
| 5 | The guest pays the full balance | The cashier captures payment and closes the bill | The bill state becomes paid, a receipt payload is generated, inventory consumption is posted, and the table session can close | Billing & Payments / Inventory Control | M3 - Billing & Stock Control |
| 6 | The session has no open bills or active orders | The cashier closes the table session | The table returns to available and the full cycle is reportable/auditable | Store Operations Platform | M3 - Billing & Stock Control |

### E2E-02: Split bill payment

| Step | Given | When | Then | Owner | Milestone |
|---|---|---|---|---|---|
| 1 | A dine-in bill contains multiple guests' items | The cashier selects split billing | The system displays valid split options and the unsplit bill total | Billing & Payments | M3 - Billing & Stock Control |
| 2 | The cashier creates two equal splits or custom split amounts | The split is confirmed | Each split has an open state and the split totals reconcile to the parent bill total with no rounding drift | Billing & Payments | M3 - Billing & Stock Control |
| 3 | Guest A pays Split A by card | The payment is captured | Split A becomes paid and the parent bill remains partially paid | Billing & Payments | M3 - Billing & Stock Control |
| 4 | Guest B pays Split B by cash | The payment is captured | Split B becomes paid, the parent bill becomes paid, and one receipt per split or configured receipt format is available | Billing & Payments | M3 - Billing & Stock Control |

### E2E-03: Partial payment to debt

| Step | Given | When | Then | Owner | Milestone |
|---|---|---|---|---|---|
| 1 | A bill has a balance due and the cashier has permission to mark debt | The guest pays less than the total due | The partial payment is recorded and the remaining balance is still visible | Billing & Payments | M3 - Billing & Stock Control |
| 2 | The remaining balance is approved for debt | The cashier chooses mark remaining balance as debt and enters the required notes/customer reference | A debt ledger charge is created with the correct balance after value | Billing & Payments | M3 - Billing & Stock Control |
| 3 | Debt is created | The cashier finalizes the bill | The bill is removed from open table collection, the table can proceed according to policy, and a debt-created audit event is recorded | Billing & Payments / Audit & Compliance | M3 - Billing & Stock Control |
| 4 | The customer later makes a debt payment | The payment is posted to the debt ledger | The debt balance decreases and debt settlement appears in reports and audit logs | Billing & Payments / Reporting & Analytics | M4 - Management & Compliance |

### E2E-04: Low-stock alert flow

| Step | Given | When | Then | Owner | Milestone |
|---|---|---|---|---|---|
| 1 | An inventory item has current stock above its reorder level | Sales or manual adjustments reduce stock to the reorder level or below | A stock ledger entry is recorded and the item becomes eligible for low-stock alerting | Inventory Control | M3 - Billing & Stock Control |
| 2 | A manager or inventory clerk opens the inventory alerts screen | The alert list loads | The low-stock item appears with current stock, unit, reorder level, and last movement context | Inventory Control | M3 - Billing & Stock Control |
| 3 | The inventory clerk receives replenishment stock | The clerk posts a purchase or adjustment above the reorder level with a reason | The alert clears or changes state, current stock updates, and the adjustment is audit logged when required | Inventory Control / Audit & Compliance | M3 - Billing & Stock Control |

### E2E-05: KDS update flow

| Step | Given | When | Then | Owner | Milestone |
|---|---|---|---|---|---|
| 1 | A placed order includes items routed to kitchen and bar stations | KDS screens refresh or subscribe to updates | Kitchen sees only kitchen-routed items and bar sees only bar-routed items | KDS Operations | M2 - Service & Fulfillment |
| 2 | A kitchen operator starts an item | The operator marks the item preparing | The KDS ticket updates, the event is published, and waiter progress reflects preparing | KDS Operations | M2 - Service & Fulfillment |
| 3 | The item is finished | The operator marks the item ready | The ticket moves to ready, waiter progress reflects ready, and order service status can advance when all required items are ready | KDS Operations / Order Management | M2 - Service & Fulfillment |
| 4 | A KDS client reconnects after a temporary LAN interruption | The client reloads the station queue | The latest authoritative ticket status is shown without duplicate updates | KDS Operations / Client Platform | M2 - Service & Fulfillment |
