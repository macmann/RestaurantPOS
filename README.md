# SYM POS

SYM POS is a TypeScript, browser-based point-of-sale system for restaurants. It combines cashier and waiter ordering, table management, kitchen/bar display queues, billing, inventory, reporting, auditing, localization, role-based access control, and receipt/order-printer support in one deployable Node.js application.

> **Runtime model:** one Express process serves the JSON API (`/api/*`), authentication (`/auth/*`), health endpoints, and the compiled browser application (`dist/frontend`). It can run with disposable in-memory repositories for evaluation or PostgreSQL for persistent installations.

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the application](#running-the-application)
- [PostgreSQL setup](#postgresql-setup)
- [Printer setup](#printer-setup)
- [Production and LAN deployment](#production-and-lan-deployment)
- [Testing and development](#testing-and-development)
- [Operations, security, and troubleshooting](#operations-security-and-troubleshooting)
- [Repository layout](#repository-layout)

## Features

- Browser screens for table/floor service, order entry, billing, kitchen, bar, inventory, menu administration, user administration, reports, audit history, and settings.
- Branch-scoped records and reporting with role/permission enforcement at API boundaries.
- Order lifecycle, item notes and modifiers, KDS progress, split bills, discounts, tax, payments, debt settlement, and receipt generation.
- Inventory stock movements, low-stock alerts, and optional menu-to-inventory linking.
- English/Myanmar UI resources and configurable receipt/business information.
- In-memory mode for a zero-database trial and PostgreSQL repositories for durable operation.
- Retry-aware browser networking, optimistic concurrency, and idempotency-key replay protection.
- Simulated, Windows spooler, and TCP network printer transports.

## Architecture

### Deployment topology

```mermaid
flowchart LR
    subgraph Clients[Restaurant client devices]
      C[Cashier / waiter browser]
      K[Kitchen display]
      B[Bar display]
      M[Manager browser]
    end

    C & K & B & M -->|HTTP on private LAN| E[Express application\nNode.js process]
    E --> A[Auth and RBAC]
    E --> D[Domain services\nmenu, tables, orders, KDS,\nbilling, inventory, reports, audit]
    E --> F[Compiled frontend\ndist/frontend]
    D --> R{Repository backend}
    R -->|evaluation| I[In-memory state]
    R -->|production| P[(PostgreSQL)]
    D --> H[Receipt / kitchen / bar printers]
```

The intended restaurant installation has one wired server host with a stable LAN address. Cashier terminals, tablets, and display screens use an ordinary browser and do not require a local application install. Internet access is not required for core workflows when the server, database, and clients remain reachable on the LAN.

### Application layers

```mermaid
flowchart TB
    UI[frontend/\nTypeScript browser UI] -->|Bearer token + JSON| HTTP[backend/server.ts\nExpress routing, validation, error mapping]
    HTTP --> AUTH[Authentication middleware\nand permission policies]
    AUTH --> SVC[Domain controllers and services]
    SVC --> REPO[Domain repositories]
    REPO --> MEM[Process memory]
    REPO --> SQL[Generic record store / PostgreSQL]
    SVC --> HW[Hardware adapters and integrations]
    SHARED[shared/ contracts] -.-> UI
    SHARED -.-> HTTP
```

| Layer | Responsibility |
| --- | --- |
| Browser UI | Renders role-appropriate screens, stores the active session, calls the API, and applies reconnect/backoff behavior. |
| HTTP/API | Parses JSON, authenticates users, authorizes actions, validates basic inputs, serializes results, and serves static frontend assets. |
| Domain modules | Implement menu, table, order, KDS, billing, inventory, reports, user, audit, settings, and hardware behavior. |
| Repositories | Select in-memory or PostgreSQL-backed persistence without changing domain workflows. |
| PostgreSQL | Stores branch and operational data, sessions, settings, audit records, and idempotency responses in persistent mode. |
| Hardware adapters | Send output to a simulator, a Windows-installed printer, or a network printer (normally raw TCP port 9100). |

### Request and data flow

1. A user signs in through `POST /auth/login`; the browser sends the returned bearer token on protected calls.
2. `backend/server.ts` loads the session, checks that the account is active, and applies route permissions.
3. A controller/service executes business rules and uses the selected repository backend.
4. Mutating clients can send an `Idempotency-Key` header. Reusing the same key and request returns the stored response; reusing it for a different request returns a conflict.
5. Orders feed station queues; KDS/bar progress and billing changes update authoritative server state.
6. Express returns JSON under `/api` and serves the single-page application for non-API routes.

### Runtime boundaries

- Public liveness endpoints: `GET /healthz` and `GET /api/health`.
- Authentication endpoints: `/auth/login`, `/auth/logout`, and `/auth/me`.
- Protected domains: `/api/menu`, `/api/tables`, `/api/orders`, `/api/kds`, `/api/billing`, `/api/inventory`, `/api/reports`, `/api/audit`, `/api/users`, and `/api/settings`.
- Frontend fallback: any non-API route is resolved to a compiled asset or `dist/frontend/index.html`.
- JSON request bodies are limited to 1 MB.

For more design detail, see [architecture decisions](docs/architecture.md), the [entity relationship model](docs/erd.md), [pricing rules](docs/pricing-rules.md), and the [RBAC matrix](docs/rbac-matrix.md).

## Prerequisites

### Required for every installation

| Requirement | Version / notes |
| --- | --- |
| Node.js | **20.x or newer recommended**. The project targets ES2022 and the Render blueprint pins Node 20. |
| npm | Included with Node.js. Use the lockfile with `npm ci` for repeatable installs. |
| Browser | A current Chromium, Firefox, or Safari release with JavaScript and local storage enabled. |
| Network | Localhost for development; a reliable private Ethernet/Wi-Fi LAN for multiple terminals. |

Verify the toolchain:

```bash
node --version
npm --version
```

### Required for persistent operation

- PostgreSQL 14 or newer (local, LAN-hosted, or managed) and credentials allowed to create tables, indexes, and constraints in the target database.
- A database backup policy and enough storage for operational and audit history.
- Network reachability from the Node.js host to PostgreSQL.

PostgreSQL is **not** required for an evaluation in memory mode. Memory-mode data is lost every time the server process stops and must not be used for real restaurant operations.

### Optional hardware and platform requirements

- A Windows host with PowerShell and an installed printer driver for `windows` printer transport.
- An ESC/POS-compatible Ethernet/Wi-Fi printer reachable from the server for `network` transport.
- A UPS for the server, database/network equipment, and critical terminals.
- A reverse proxy and TLS certificate if HTTPS is required. The Node process itself is HTTP-only.

## Installation

### 1. Get the source

```bash
git clone <repository-url> RestaurantPOS
cd RestaurantPOS
```

If the repository is already present, run all remaining commands from its root (the directory containing `package.json`).

### 2. Install exact dependencies

```bash
npm ci
```

Use `npm install` only when intentionally changing dependencies; it may update `package-lock.json`.

### 3. Create local configuration

```bash
cp .env.example .env
```

On Windows PowerShell, the equivalent is:

```powershell
Copy-Item .env.example .env
```

Edit `.env` before starting. This project does **not** automatically load dotenv files. Export the file into the process environment on Linux/macOS:

```bash
set -a
. ./.env
set +a
```

In PowerShell, set variables for the current terminal explicitly, for example:

```powershell
$env:POS_REPOSITORY_BACKEND = "memory"
$env:HOST = "0.0.0.0"
$env:PORT = "8080"
```

### 4. Validate and build

```bash
npm run typecheck
npm run build
```

The backend and tests compile to `dist/backend` and `dist/tests`; the frontend build script emits browser modules, CSS, and HTML to `dist/frontend`.

### 5. Start and verify

```bash
npm start
```

Open <http://localhost:8080/> and check <http://localhost:8080/healthz>. Stop the server with `Ctrl+C`.

## Configuration

Environment variables are read when the Node process starts. Restart it after changing them. Settings changed through the application can override operational defaults and are persisted when PostgreSQL repositories are enabled.

### Core server and branch settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `APP_ENV` | `development` in template | Environment label used by deployment operations. |
| `APP_NAME` | `SYM POS` / template value | Human-readable application label. |
| `HOST` | `0.0.0.0` | Interface on which Express listens. Use `127.0.0.1` when only a local reverse proxy should connect. |
| `PORT` | `8080` | HTTP port. Managed hosts such as Render normally inject it. |
| `LAN_BASE_URL` | none | Documented canonical URL used by restaurant devices. |
| `POS_BRANCH_ID` | `main` | Stable machine-readable reporting partition. Never change it for an established location. |
| `POS_BRANCH_NAME` | `Main Branch` | Human-readable branch name. |
| `POS_LOCATION_LABEL` | none | Address/floor/location context. |
| `RESTAURANT_BRANCH_ID`, `RESTAURANT_BRANCH_NAME`, `RESTAURANT_LOCATION_LABEL` | none | Legacy fallbacks used only when the corresponding `POS_*` value is absent. |
| `AUTH_SESSION_TTL_MS` | `43200000` (12 hours) | Login session lifetime in milliseconds. |

### Repository and database settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `POS_REPOSITORY_BACKEND` | memory unless a URL enables SQL | Set to `postgres` for persistence or `memory` to explicitly disable SQL. |
| `DATABASE_URL` | none | Full PostgreSQL URL. Takes precedence over individual connection fields. A URL enables PostgreSQL unless backend is explicitly `memory`. |
| `DB_CLIENT` | `postgres` | Only `postgres` is supported. |
| `DB_HOST` | `127.0.0.1` | PostgreSQL host when `DATABASE_URL` is absent. |
| `DB_PORT` | `5432` | PostgreSQL port. |
| `DB_NAME` | `restaurant_pos` | Database name. |
| `DB_USER` | `pos_user` | Database login role. |
| `DB_PASSWORD` | empty | Database password. Never commit a real value. |
| `DB_SSL` | `false` | Accepts `1`, `true`, `yes`, or `require`; SSL certificate verification is disabled by the current client configuration. |

### Browser reconnect policy

| Variable | Default | Purpose |
| --- | --- | --- |
| `POS_RECONNECT_INITIAL_DELAY_MS` | `500` | Initial retry delay. |
| `POS_RECONNECT_MAX_DELAY_MS` | `10000` | Backoff ceiling. |
| `POS_RECONNECT_JITTER_MS` | `250` | Random delay added to spread simultaneous reconnects. |
| `POS_RETRY_MAX_SAFE_ATTEMPTS` | `6` | Attempts for reads and idempotent writes. |
| `POS_RETRY_MAX_UNSAFE_ATTEMPTS` | `1` | Attempts for writes without an idempotency key. |
| `POS_HEALTH_CHECK_INTERVAL_MS` | `5000` | Health polling interval while disconnected. |

### Restaurant, tax, and localization defaults

| Variable | Default | Purpose |
| --- | --- | --- |
| `POS_RESTAURANT_NAME` | branch name | Name printed on bills. |
| `POS_RESTAURANT_ADDRESS` | configured placeholder | Receipt address. |
| `POS_RESTAURANT_CONTACT` | configured placeholder | Receipt contact text. |
| `POS_RESTAURANT_TAX_ID` | none | Optional tax identifier. |
| `POS_RECEIPT_FOOTER` | thank-you message | Receipt footer. |
| `POS_TAX_ENABLED` | `false` | Enables default tax calculation. |
| `POS_TAX_RATE` | `0` | Non-negative tax rate used by settings. |
| `POS_MENU_INVENTORY_LINK_ENABLED` | `false` | Enables menu/inventory linking. |
| `POS_DEFAULT_LOCALE` / `DEFAULT_LOCALE` | internal default / `en-US` template | Initial UI locale; `POS_DEFAULT_LOCALE` takes precedence. |
| `DEFAULT_CURRENCY` | `USD` in template | Deployment currency metadata. |
| `TIMEZONE` | operator supplied | Host/deployment timezone. Set it to the restaurant's IANA timezone. |
| `LOG_LEVEL`, `AUDIT_RETENTION_DAYS` | template values | Operational policy values reserved for logging/retention tooling. |

### Printer defaults

Receipt variables use the `POS_RECEIPT_*` prefix. Kitchen and bar use `POS_KITCHEN_*` and `POS_BAR_*` respectively.

| Suffix / example | Default | Purpose |
| --- | --- | --- |
| `PRINTER_ENABLED` | `true` | Enables the device. Example: `POS_KITCHEN_PRINTER_ENABLED`. |
| `PRINTER_ID` | generated per station | Stable device identifier. |
| `PRINTER_NAME` | generated display name | Operator-facing printer name. |
| `PRINTER_TYPE` | `simulator` | `simulator`, `network`, or `windows`. |
| `WINDOWS_PRINTER_NAME` | none | Exact Windows print queue name; receipt example: `POS_RECEIPT_WINDOWS_PRINTER_NAME`. |
| `PRINTER_ADDRESS` | none | Network printer hostname/IP. |
| `PRINTER_PORT` | `9100` | Raw TCP printer port. |
| `PRINTER_COPIES` | `1` | Number of copies (normalized to 1–10). |
| `PRINTER_AUTO_PRINT` | enabled for prep stations | Automatic station printing. Receipt auto-print defaults off. |

The `.env.example` contains a safe starting template. Values documented as “reserved” may not yet alter runtime behavior; they are included for deployment consistency.

## Running the application

### Fast evaluation (in-memory)

```bash
export POS_REPOSITORY_BACKEND=memory
npm run start:local
```

`start:local` rebuilds before starting. Browse to <http://localhost:8080/>. All records disappear when the process exits.

### Development commands

Run the API directly from TypeScript (build the frontend separately first if browser assets are needed):

```bash
npm run build:frontend
npm run dev:api
```

Preview only the compiled frontend on port 4173 by default:

```bash
npm run dev:frontend
```

The frontend-only preview does not replace the API for complete POS workflows.

### Default bootstrap login

| Username | Password | Role |
| --- | --- | --- |
| `superadmin` | `password123` | `superadmin` |

The account is created when missing. **Treat these as bootstrap credentials only:** sign in, create named staff/admin accounts, and deactivate or otherwise rotate the default account before allowing production access. Passwords are PBKDF2-hashed, while session tokens are stored as hashes.

### Access from another LAN device

1. Give the server a static IP/DHCP reservation, for example `192.168.10.10`.
2. Keep `HOST=0.0.0.0`, start the application, and allow inbound TCP port 8080 from the private subnet in the host firewall.
3. Open `http://192.168.10.10:8080/` from each terminal. Do not enter `0.0.0.0` in a browser; it is a bind address.
4. Verify login, ordering, KDS updates, billing, and reconnect behavior from actual devices.

## PostgreSQL setup

### Option A: connection URL

```bash
export POS_REPOSITORY_BACKEND=postgres
export DATABASE_URL='postgres://pos_user:replace_me@127.0.0.1:5432/restaurant_pos'
export DB_SSL=false
npm run db:migrate
npm run build
npm start
```

### Option B: individual connection fields

```bash
export POS_REPOSITORY_BACKEND=postgres
export DB_CLIENT=postgres
export DB_HOST=127.0.0.1
export DB_PORT=5432
export DB_NAME=restaurant_pos
export DB_USER=pos_user
export DB_PASSWORD='replace_me'
export DB_SSL=false
npm run db:migrate
```

The migration runner applies `schema/migrations/20260505140000_initial_restaurantpos_schema.sql`. Use a dedicated application role/database, restrict network access, and test migrations against a backup before upgrading a live installation.

For managed PostgreSQL, use the provider URL and its required SSL setting. Keep URL query parameters intact. `DB_SSL=true` currently configures encrypted transport with certificate verification disabled, so use a trusted private network or provider endpoint and assess this behavior against your security requirements.

### Switching modes safely

- `POS_REPOSITORY_BACKEND=memory` always chooses volatile memory, even if `DATABASE_URL` exists.
- `POS_REPOSITORY_BACKEND=postgres` chooses PostgreSQL.
- A non-empty `DATABASE_URL` also chooses PostgreSQL when backend is not explicitly `memory`.
- Run migrations before the first persistent start and after pulling schema changes.
- Memory data is not automatically migrated into PostgreSQL.

## Printer setup

### Simulator

Keep `PRINTER_TYPE=simulator` for development and validate flows without physical hardware.

### Windows installed/USB printer

Run the API on the Windows computer that owns the printer queue. Set the exact queue name shown in **Settings > Bluetooth & devices > Printers & scanners**:

```powershell
$env:POS_RECEIPT_PRINTER_TYPE = "windows"
$env:POS_RECEIPT_WINDOWS_PRINTER_NAME = "Your exact queue name"
```

The Windows driver controls paper size and device preferences. Install a Myanmar-capable font such as Noto Sans Myanmar, Myanmar Text, Padauk, or Pyidaungsu when printing Myanmar text. A Linux server cannot use a USB printer installed only on a cashier's Windows PC.

### Network ESC/POS printer

```bash
export POS_KITCHEN_PRINTER_TYPE=network
export POS_KITCHEN_PRINTER_ADDRESS=192.168.10.30
export POS_KITCHEN_PRINTER_PORT=9100
```

Give printers reserved IP addresses and allow the Node host to reach their TCP ports. ASCII tickets use native ESC/POS output. Jobs containing Myanmar text are rasterized through Windows, so Myanmar network printing also requires the API host to be Windows.

Printer configuration is also available in the manager settings UI. Always perform test prints for receipts, kitchen tickets, bar tickets, special characters, cutting, and drawer behavior before service.

## Production and LAN deployment

### Recommended on-premises topology

- Put the Node host on wired Ethernet and give it a static lease/local DNS record.
- Run PostgreSQL locally or on another protected LAN host; never expose it publicly.
- Restrict the POS HTTP port to restaurant/private-management networks.
- Use a process/service manager configured to restart the app after failure and boot.
- Put the server, switch/router, access points, and database host on UPS power.
- Back up PostgreSQL off the primary machine and regularly test restoration.
- Put HTTPS at a reverse proxy when credentials cross any network that is not fully trusted.
- Monitor `/healthz`, disk capacity, database availability, backups, and printer connectivity.

See [docs/deployment-lan.md](docs/deployment-lan.md) for the device, retry, conflict-handling, and opening checklist.

### Render deployment

`render.yaml` defines one Node web service. Create a PostgreSQL database (for example Neon), then deploy the repository as a Render Blueprint and supply `DATABASE_URL` when prompted. The blueprint:

1. runs `npm ci && npm run build`;
2. sets production, PostgreSQL, and SSL environment values;
3. runs `npm run render:start`, which migrates then starts Express; and
4. checks `/healthz`.

For a manual Render service use:

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Build command | `npm ci && npm run build` |
| Start command | `npm run render:start` |
| Health check | `/healthz` |
| Required environment | `APP_ENV=production`, `POS_REPOSITORY_BACKEND=postgres`, `DATABASE_URL=...`, `DB_SSL=true` |

Render supplies `PORT`; do not hard-code it. Cloud hosting makes the service WAN-dependent and cannot directly reach printers or clients isolated on the restaurant LAN without additional secure networking.

## Testing and development

| Command | What it does |
| --- | --- |
| `npm run typecheck` | Strict TypeScript validation without output. |
| `npm run build` | Builds CommonJS backend/tests and ES-module browser assets. |
| `npm run test:unit` | Runs authoritative-menu order unit coverage. |
| `npm run test:e2e` | Runs the in-memory workflow, API, concurrency, browser-screen, reconnect, and persistence-oriented suite. |
| `npm run test:api` | Runs API integration coverage. |
| `npm run test:concurrency` | Runs concurrency behavior coverage. |
| `npm run test:browser:e2e` | Runs browser screen and reconnect tests. |
| `npm run test:db:e2e` | Runs database persistence coverage after compiling. |
| `npm run test:integration` | Runs SQL repository, hardware/billing, and API integration checks. |
| `npm run db:migrate` | Applies the PostgreSQL migration. |

Database-dependent tests use the exported PostgreSQL settings. Point them only at a disposable test database: integration checks may migrate or mutate it. If no database host is configured, supported SQL integration checks report that they were skipped.

Before submitting a change, run at minimum:

```bash
npm run typecheck
npm run build
npm run test:unit
npm run test:e2e
```

## Operations, security, and troubleshooting

### Opening checklist

- Confirm `/healthz` from the server and at least one client device.
- Confirm the displayed branch/location and current business settings.
- Place a test order and verify kitchen/bar routing.
- Complete a test bill and print each required document.
- Confirm PostgreSQL backups and free disk space.
- Disconnect/reconnect a test device and verify the UI refreshes authoritative state.

### Security checklist

- Replace/deactivate bootstrap credentials and create individual, least-privilege staff accounts.
- Never commit `.env`, database URLs, passwords, tokens, backups, or production exports.
- Segment POS devices from guest Wi-Fi and untrusted devices.
- Prefer HTTPS through a reverse proxy and restrict firewall rules to known networks.
- Protect database backups and test recovery procedures.
- Review audit records and deactivate departed staff promptly.
- Do not repeatedly retry payment/void/debt writes without an idempotency key; refresh the bill first after a network interruption.

### Backup and recovery

Use your PostgreSQL provider's managed backups or standard PostgreSQL tools. A typical logical backup is:

```bash
pg_dump --format=custom --file=restaurant_pos.dump "$DATABASE_URL"
```

Restores should be rehearsed into a separate database using the matching PostgreSQL tool version. Back up environment/service configuration separately, but keep secrets encrypted and access-controlled. In-memory mode has no backup or recovery path.

### Common problems

| Symptom | Resolution |
| --- | --- |
| `Frontend build not found` | Run `npm run build` (or `npm run build:frontend`) before `npm start`. |
| Browser cannot connect from another device | Check server IP, `HOST`, port, host firewall, VLAN/client isolation, and that the URL uses the server's IP rather than `localhost`. |
| Database connection/migration fails | Verify exported variables, credentials, DNS/port reachability, SSL requirement, database privileges, and that `.env` was actually loaded. |
| Data disappears after restart | Set PostgreSQL configuration, migrate, and run with `POS_REPOSITORY_BACKEND=postgres`; memory is intentionally ephemeral. |
| Managed deployment fails at startup | Inspect migration logs first; `render:start` stops if the database cannot be migrated. |
| Login fails on a fresh system | Use the bootstrap login exactly once, then verify the configured branch/database if it is not created. |
| Printer is unreachable | Confirm it is enabled, transport type is correct, queue/address/port is exact, and connectivity originates from the API host. |
| Port already in use | Stop the other service or export a different `PORT`, then update client URLs/firewall rules. |

## Repository layout

| Path | Purpose |
| --- | --- |
| `backend/server.ts` | Express composition, routes, health checks, static app serving, and HTTP error handling. |
| `backend/auth/` | Password authentication, hashed sessions, middleware, policies, and permissions. |
| `backend/{menu,tables,orders,kds,billing,inventory,reports,audit,users}/` | Domain services, controllers, and repositories. |
| `backend/db/` | PostgreSQL configuration, transaction support, migrations, and repository store. |
| `backend/config/` | Branch and operational POS settings. |
| `backend/hardware/` | Barcode, cash drawer, receipt/order printer, transport, and status adapters. |
| `frontend/` | TypeScript browser application, API client, screens/view models, styles, localization, and reconnect policy. |
| `shared/` | Cross-boundary TypeScript declarations/contracts. |
| `schema/migrations/` | PostgreSQL schema migration source. |
| `scripts/` | Frontend build/preview and migration entry points. |
| `tests/` | Unit, integration, concurrency, browser, reconnect, persistence, and end-to-end workflows. |
| `docs/` | Architecture, deployment, ERD, RBAC, pricing, acceptance, and readiness references. |
| `render.yaml` | Render Blueprint for the combined service. |

## Additional documentation

- [Architecture decisions](docs/architecture.md)
- [LAN deployment guide](docs/deployment-lan.md)
- [Entity relationship model](docs/erd.md)
- [Role/permission matrix](docs/rbac-matrix.md)
- [Pricing rules](docs/pricing-rules.md)
- [MVP acceptance criteria](docs/mvp-acceptance.md)
- [End-to-end readiness](docs/e2e-pos-readiness.md)
- [Operator user guide](userguide.md)
