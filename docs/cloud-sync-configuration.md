# POS cloud synchronization configuration

On `APP_MODE=POS` deployments, a Super Admin can configure the existing hybrid synchronization worker at **Platform Settings → Cloud Synchronization**. Database-backed values take precedence over the corresponding environment variables. Until settings are explicitly saved, the existing `CLOUD_API_URL`, `SYNC_API_TOKEN`, `POS_STORE_ID`, `POS_DEVICE_ID`, and `SYNC_*` variables remain effective as bootstrap/fallback configuration.

The Sync API Token is never included in the settings response or audit payload. A database-backed token is encrypted locally with AES-256-GCM before it is written to the separate `secrets:cloud-sync` record. The encryption key is derived from `SYNC_SETTINGS_ENCRYPTION_KEY`, which must be supplied by the deployment and must not be stored in PostgreSQL. An empty token field preserves the current encrypted token; when no encrypted token exists, `SYNC_API_TOKEN` remains the fallback.

The worker resolves configuration again before every push and pull cycle, so saving does not require an application restart. Disabling synchronization skips push, polling, and heartbeat work without changing either durable queue. Cloud deployments (`APP_MODE=CLOUD`) do not expose these POS destination settings.

## Cloud connection information

On a cloud deployment, Super Admin instead sees **Platform Settings → Cloud Connection Information**. It displays the public base URL, readiness checks, token-presence status, real sync routes, recommended local defaults, and a copyable (secret-free) local setup package. The existing `SYNC_API_TOKEN` is never returned to the browser.

Configure a Render cloud service with:

```env
APP_MODE=CLOUD
PUBLIC_BASE_URL=https://<render-service-domain>
DATABASE_URL=<cloud-postgres-url>
SYNC_API_TOKEN=<long-random-secret>
```

`PUBLIC_BASE_URL` is the authoritative internet-facing origin and is normalized without a trailing slash. Render's trusted `RENDER_EXTERNAL_HOSTNAME` metadata is used only when the explicit value is absent. Do not use Render's internal `localhost` binding, and do not set `CLOUD_API_URL` on the cloud: the cloud server never starts the local outbound worker or synchronizes to itself.
