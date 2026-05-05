# RestaurantPOS Architecture Decisions

## 1) LAN-first operation

RestaurantPOS is designed for on-premise, local-network-first environments where internet connectivity may be unreliable.

- Core POS workflows (login, menu access, order entry, kitchen updates, payment capture, and receipt generation) must function over a private LAN.
- Services bind to private interfaces and are reachable via static/local DNS records within the restaurant network.
- External integrations (cloud backup, third-party analytics, remote support) are optional and asynchronous to avoid blocking in-store operations.
- Operational defaults prioritize low-latency local access and graceful degradation when WAN connectivity is unavailable.

## 2) API boundaries

The system is split into clear domains with explicit API responsibilities:

- **Frontend (`frontend/`)**: UI shell and operator-facing clients (cashier, manager, kitchen views).
- **Backend (`backend/`)**: Domain APIs and business rules for POS operations.
- **Shared (`shared/`)**: Cross-cutting contracts and reusable assets (DTOs/schemas/constants).

### Backend API style

- Domain-oriented modules expose internal service contracts and external API endpoints.
- Shared request/response models should be versioned to preserve compatibility for in-store clients.
- Authentication and authorization are centralized and enforced consistently at API boundaries.

## 3) Service responsibilities by backend module

- `auth`: staff authentication, token/session lifecycle, role/permission checks.
- `users`: employee profiles, staffing roles, account lifecycle management.
- `menu`: catalog structure, pricing, modifiers, availability windows.
- `orders`: order creation/state transitions, item-level notes, fulfillment flow.
- `billing`: taxes, discounts, tenders, receipt/transaction records.
- `inventory`: stock tracking, usage deductions, low-stock thresholds.
- `reports`: operational and financial reporting endpoints.
- `kds`: kitchen display queue, ticket prioritization, prep status signaling.
- `settings`: store-level configuration, locale/currency/time settings.
- `audit`: immutable event trails for sensitive actions and compliance visibility.

## 4) Cross-cutting principles

- **Observability**: structured logging with correlation IDs across modules.
- **Security**: least-privilege access, auditable privileged actions, secure secret handling.
- **Resilience**: idempotent writes where possible and retry-safe integration patterns.
- **Deployability**: environment-driven configuration (`.env`) tuned for local-network deployment.
