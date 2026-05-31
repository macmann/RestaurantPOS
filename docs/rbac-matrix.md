# SYM POS Role & Permission Matrix

This matrix defines route-level authorization for core POS actions. Permissions are additive: a role inherits all actions explicitly marked ✅.

## Roles

- **Waitstaff**: floor service, order capture, table cleanup, and same-shift payment closeout.
- **Cashier**: front-of-house order and billing execution.
- **Shift Lead**: supervises shift activity; can handle exceptions.
- **Inventory Clerk**: manages stock movement and adjustments.
- **Manager**: full operational oversight and reporting access.
- **Admin**: system-level access, including user lifecycle and role assignment.

## Explicit Action Matrix

| Action | Waitstaff | Cashier | Shift Lead | Inventory Clerk | Manager | Admin |
|---|---:|---:|---:|---:|---:|---:|
| Create order (`orders:create`) | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| Edit order (`orders:edit`) | ✅ (own/open order) | ✅ (own/open order) | ✅ | ❌ | ✅ | ✅ |
| Adjust stock (`stock:adjust`) | ❌ | ❌ | ✅ (limited) | ✅ | ✅ | ✅ |
| Mark debt (`billing:mark_debt`) | ❌ | ✅ | ✅ | ❌ | ✅ | ✅ |
| Close bill (`billing:close`) | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| View reports (`reports:view`) | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| View audit log (`audit:view`) | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |

## Route Mapping

The backend should enforce action checks at route boundaries:

- `POST /orders` → `orders:create`
- `PATCH /orders/:id` → `orders:edit`
- `POST /inventory/adjustments` → `stock:adjust`
- `POST /billing/:id/mark-debt` → `billing:mark_debt`
- `POST /billing/:id/close` → `billing:close`
- `POST /orders/:id/status` → `orders:transition_status`
- `GET /reports/*` → `reports:view`
- `GET /audit` → `audit:view`

## User Status Constraint (Active / Inactive)

Authorization is **gated by user status**:

1. Inactive users cannot authenticate successfully.
2. If a user is deactivated after login, all authenticated requests must be rejected.
3. Privileged operations (role changes, status changes) should be audit logged.

## Enforcement Rules

- Default deny: any action not explicitly granted is denied.
- Role + status are both required for access.
- Multi-role users are allowed if any active role grants the action.
- Services should return:
  - `401` when authentication fails or session is invalid.
  - `403` when authenticated but lacking permission or inactive.
