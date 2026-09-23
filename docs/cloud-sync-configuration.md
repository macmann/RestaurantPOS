# POS cloud synchronization configuration

On `APP_MODE=POS` deployments, a Super Admin can configure the existing hybrid synchronization worker at **Platform Settings → Cloud Synchronization**. Database-backed values take precedence over the corresponding environment variables. Until settings are explicitly saved, the existing `CLOUD_API_URL`, `SYNC_API_TOKEN`, `POS_STORE_ID`, `POS_DEVICE_ID`, and `SYNC_*` variables remain effective as bootstrap/fallback configuration.

The Sync API Token is never included in the settings response or audit payload. A database-backed token is encrypted locally with AES-256-GCM before it is written to the separate `secrets:cloud-sync` record. The encryption key is derived from `SYNC_SETTINGS_ENCRYPTION_KEY`, which must be supplied by the deployment and must not be stored in PostgreSQL. An empty token field preserves the current encrypted token; when no encrypted token exists, `SYNC_API_TOKEN` remains the fallback.

The worker resolves configuration again before every push and pull cycle, so saving does not require an application restart. Disabling synchronization skips push, polling, and heartbeat work without changing either durable queue. Cloud deployments (`APP_MODE=CLOUD`) do not expose these POS destination settings.
