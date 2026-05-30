# RestaurantPOS

RestaurantPOS is a TypeScript point-of-sale foundation for restaurants. It models branch-scoped ordering, kitchen/bar display workflows, billing, inventory, reporting, auditing, localization, and LAN-first reconnect behavior.

> **Current runtime status:** this repository currently contains domain modules, frontend view-model helpers, database schema files, and an end-to-end in-memory workflow test. It does **not** yet include a long-running HTTP server or packaged browser app entry point. Use the scripts below to type-check, build, and validate the POS flow.

## Repository layout

| Path | Purpose |
| --- | --- |
| `backend/` | Business logic and backend controllers/repositories for auth, users, menu, orders, billing, KDS, inventory, reports, audit, i18n, and runtime config. |
| `frontend/` | UI-facing TypeScript view-model helpers for order entry, billing, KDS/bar screens, admin screens, localization, and reconnect policy. |
| `shared/` | Cross-cutting shared TypeScript contracts. |
| `tests/` | End-to-end POS workflow test that exercises the domain modules after compilation. |
| `schema/migrations/` | PostgreSQL schema migration for a future persistent deployment. |
| `docs/` | Architecture, LAN deployment, RBAC, ERD, pricing rules, MVP acceptance, and readiness documentation. |

## Prerequisites

- Node.js 20 or newer is recommended because the code targets modern ECMAScript (`ES2022`) and uses APIs such as `structuredClone`.
- npm, bundled with Node.js.
- PostgreSQL 14+ only if you are preparing a persistent database from `schema/migrations/`. The current automated test flow uses in-memory repositories and does not require a running database.

## Install dependencies

This project intentionally has no checked-in dependency list beyond scripts that invoke TypeScript through `npx`. Install or resolve TypeScript before running checks:

```bash
npm install --save-dev typescript
```

Alternatively, if you do not want to write a local `package-lock.json`, `npx` can download TypeScript on demand when the scripts run.

## Environment configuration

1. Copy the template:

   ```bash
   cp .env.example .env
   ```

2. Edit `.env` for your branch, LAN host, database, locale, and retry behavior.
3. Export the values before running Node/npm commands that need runtime settings. Node does not automatically load `.env` files in this repository yet:

   ```bash
   set -a
   . ./.env
   set +a
   ```

### `.env` reference

| Variable | Required? | Default in code/template | Description |
| --- | --- | --- | --- |
| `APP_ENV` | No | `development` | Deployment environment label for operators and future server startup. |
| `APP_NAME` | No | `RestaurantPOS` | Human-readable app name. |
| `HOST` | No | `0.0.0.0` | Intended server bind address for a future HTTP/API process. |
| `PORT` | No | `8080` | Intended server port for a future HTTP/API process. |
| `LAN_BASE_URL` | Recommended for deployments | Example LAN URL | Base URL client devices should use on the restaurant network. |
| `DB_CLIENT` | Required for persistent DB deployment | `postgres` | Database engine expected by the schema migration. |
| `DB_HOST` | Required for persistent DB deployment | Example LAN IP | PostgreSQL host. |
| `DB_PORT` | Required for persistent DB deployment | `5432` | PostgreSQL port. |
| `DB_NAME` | Required for persistent DB deployment | `restaurant_pos` | PostgreSQL database name. |
| `DB_USER` | Required for persistent DB deployment | `pos_user` | PostgreSQL user. |
| `DB_PASSWORD` | Required for persistent DB deployment | `change_me` | PostgreSQL password. Change this for every environment. |
| `DB_SSL` | No | `false` | Whether the PostgreSQL client should use SSL in a future persistent runtime. |
| `POS_BRANCH_ID` | Recommended | `main` in code | Stable branch/location key used to partition reports and records. Keep it unchanged for a physical branch. |
| `POS_BRANCH_NAME` | Recommended | `Main Branch` in code | Human-readable branch name for manager UI and exports. |
| `POS_LOCATION_LABEL` | No | unset | Address, mall, floor, or other location label for receipt/report context. |
| `RESTAURANT_BRANCH_ID` | No | fallback only | Legacy/alternate fallback used if `POS_BRANCH_ID` is unset. |
| `RESTAURANT_BRANCH_NAME` | No | fallback only | Legacy/alternate fallback used if `POS_BRANCH_NAME` is unset. |
| `RESTAURANT_LOCATION_LABEL` | No | fallback only | Legacy/alternate fallback used if `POS_LOCATION_LABEL` is unset. |
| `POS_RECONNECT_INITIAL_DELAY_MS` | No | `500` | Initial client retry delay for LAN failures. |
| `POS_RECONNECT_MAX_DELAY_MS` | No | `10000` | Maximum reconnect delay after exponential backoff. |
| `POS_RECONNECT_JITTER_MS` | No | `250` | Random jitter to avoid all terminals retrying simultaneously. |
| `POS_RETRY_MAX_SAFE_ATTEMPTS` | No | `6` | Maximum retries for reads and idempotent writes. |
| `POS_RETRY_MAX_UNSAFE_ATTEMPTS` | No | `1` | Maximum retries for non-idempotent writes without an idempotency key. |
| `POS_HEALTH_CHECK_INTERVAL_MS` | No | `5000` | Health-check interval while a client is degraded/offline. |
| `DEFAULT_LOCALE` | No | `en-US` in template | Default locale expected by deployment tooling. Current i18n helpers support English and Myanmar resources internally. |
| `DEFAULT_CURRENCY` | No | `USD` | Currency code for future receipt/report formatting. |
| `TIMEZONE` | Recommended | `America/New_York` in template | Restaurant timezone for business-day reporting and operations. |
| `LOG_LEVEL` | No | `info` | Intended logging verbosity for a future server runtime. |
| `AUDIT_RETENTION_DAYS` | Recommended | `365` | Intended retention period for audit events. |

## How to run locally

### Type-check

```bash
npm run typecheck
```

### Build

```bash
npm run build
```

Compiled JavaScript is emitted to `dist/`.

### Run the end-to-end POS workflow

```bash
npm run test:e2e
```

This command compiles the TypeScript project and runs `dist/tests/e2e-pos-flow.test.js`. The test creates users, inventory, menu data, an order, KDS progress, billing/payment records, reports, and frontend view models using the in-memory repositories.

### Run database migrations

Persistent PostgreSQL deployments can apply the checked-in schema migration with the documented `DB_*` environment variables:

```bash
npm run db:migrate
```

### Run SQL repository integration checks

When `DB_HOST`/`PGHOST` and the other PostgreSQL settings are exported, this check applies the migration to that disposable database and runs the repository-backed POS flow. If no database is configured, the test exits with a skip message so local in-memory checks remain lightweight.

```bash
npm run test:integration
```

## Database schema setup

For a PostgreSQL-backed deployment, create the database/user matching `.env`, then apply the migration runner:

```bash
npm run db:migrate
```

The runner reads `DB_CLIENT`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, and `DB_SSL` from the environment.

## LAN deployment notes

- Give the POS server host a static DHCP lease or static IP.
- Keep the service on the private restaurant LAN; do not expose it directly to the internet.
- Point terminals/tablets/KDS screens at `LAN_BASE_URL` or a local DNS name such as `pos.local`.
- Keep `POS_BRANCH_ID` stable for the branch forever; changing it splits reporting history.
- See `docs/deployment-lan.md` for the full LAN checklist and reconnect guidance.

## Useful npm scripts

| Script | Command | Description |
| --- | --- | --- |
| `typecheck` | `npx tsc --noEmit` | Validates TypeScript without writing output. |
| `build` | `npx tsc -p tsconfig.json --outDir dist` | Compiles all included TypeScript to `dist/`. |
| `test:e2e` | `npm run build -- --noEmit false && node dist/tests/e2e-pos-flow.test.js` | Builds and executes the end-to-end POS flow test. |

## Additional documentation

- `docs/architecture.md` - LAN-first architecture and module boundaries.
- `docs/deployment-lan.md` - restaurant-local deployment and reconnect behavior.
- `docs/erd.md` - entity relationship model.
- `docs/pricing-rules.md` - discount, tax, and billing calculation rules.
- `docs/rbac-matrix.md` - role/permission matrix.
- `docs/mvp-acceptance.md` - MVP acceptance criteria.
- `docs/e2e-pos-readiness.md` - end-to-end readiness notes.
