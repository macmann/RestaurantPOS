# POS cloud synchronization configuration

On `APP_MODE=POS` deployments, a Super Admin can configure the existing hybrid synchronization worker at **Platform Settings → Cloud Synchronization**. Database-backed values take precedence over the corresponding environment variables. Until settings are explicitly saved, the existing `CLOUD_API_URL`, `SYNC_API_TOKEN`, `POS_STORE_ID`, `POS_DEVICE_ID`, and `SYNC_*` variables remain effective as bootstrap/fallback configuration.

The Sync API Token is never included in the settings response or audit payload. A database-backed token is encrypted locally with AES-256-GCM before it is written to the separate `secrets:cloud-sync` record. The encryption key is derived from `SYNC_SETTINGS_ENCRYPTION_KEY`, which must be supplied by the deployment and must not be stored in PostgreSQL. An empty token field preserves the current encrypted token; when no encrypted token exists, `SYNC_API_TOKEN` remains the fallback.

The worker resolves configuration again before every push and pull cycle, so saving does not require an application restart. Disabling synchronization skips push, polling, and heartbeat work without changing either durable queue. Cloud deployments (`APP_MODE=CLOUD`) do not expose these POS destination settings.

Every synchronization cycle also exchanges a complete, versioned menu snapshot through `/cloud/sync/menu/reconcile`. The durable event queues still deliver normal changes quickly, but the snapshot is an anti-entropy safety net: it restores items or categories when an event was missed, acknowledged by an older installation, or created before bidirectional menu sync was deployed. Both sides merge by `updatedAt` with a deterministic source tie-break, include deletion tombstones, and suppress echo events while applying the peer snapshot. As a result, adding, editing, or deleting a menu record in either the local POS or cloud manager converges without requiring the queue history to remain intact.

The Store ID must be the same stable identifier as the POS Branch ID (`POS_BRANCH_ID`). Menu events are partitioned by this value in the cloud incoming queue; using a different value can allow outbound uploads while preventing cloud menu edits from being pulled back. When `POS_STORE_ID` is omitted, the POS now uses its Branch ID automatically. Existing saved settings that still contain the old placeholder value `default` are resolved to the current Branch ID.

If the local application displays a menu but the cloud remains empty, open **Platform Settings → Cloud Synchronization → Synchronization diagnostics** and compare the configured Store ID with **Menu records by Store ID**. A menu created under an earlier Branch ID is still visible in the unscoped local administration view, but it does not belong to the configured synchronization partition. Menu synchronization now stops with an explicit error in that situation instead of reporting a successful zero-record exchange. Set the local `POS_BRANCH_ID`, the saved synchronization Store ID, and the cloud `POS_STORE_ID` to the identifier that owns the menu; do not rename a populated branch without migrating its data.

## Super Admin operating workflow

1. Open **Platform Settings → Cloud Synchronization** on the local POS. Confirm that the displayed Store ID is the same as the local Branch ID and the cloud assignment.
2. Enter the cloud base URL, unique Device ID, and token supplied through a secure channel. Select **Test connection** before enabling the worker; review authentication, Store ID, protocol compatibility, and latency in the response.
3. Save settings and enable synchronization. The health card tracks push, incoming pull, and heartbeat independently, and refreshes without restarting the server.
4. Use **Sync everything** for an immediate push, pull, complete menu reconciliation, and heartbeat. Use **Sync menu only** when troubleshooting menu convergence without forcing the other phases.
5. Open **View diagnostics** to inspect resolved endpoints, menu records grouped by Store ID, recent activity, pending outgoing/incoming queues, and the most recent safe error detail. Clear a displayed error only after recording it and correcting its cause. Clearing the display does not discard queued events.

A successful connection test proves connectivity and configuration compatibility; it does not prove that all queued records have been exchanged. Confirm phase timestamps, queue counts, the menu reconciliation result, and representative records on both deployments. Menu bulk imports enqueue normal menu changes after their transaction commits, so large imports may require multiple batches before the outgoing queue drains.

## Cloud connection information

On a cloud deployment, Super Admin instead sees **Platform Settings → Cloud Connection Information**. It displays the public base URL, readiness checks, token-presence status, real sync routes, recommended local defaults, and a copyable (secret-free) local setup package. The existing `SYNC_API_TOKEN` is never returned to the browser.

Configure a Render cloud service with:

```env
APP_MODE=CLOUD
PUBLIC_BASE_URL=https://<render-service-domain>
DATABASE_URL=<cloud-postgres-url>
SYNC_API_TOKEN=<long-random-secret>
POS_STORE_ID=<same value as the local POS_BRANCH_ID>
```

Set `POS_STORE_ID` explicitly on the cloud deployment. For backward compatibility, `POS_BRANCH_ID` is accepted as a normalized fallback when `POS_STORE_ID` is absent, and cloud manager menu writes use that same resolved assignment. The cloud rejects a connection test and every sync request when neither value is configured or when the resolved value differs from the Store ID sent by the local POS. This prevents a valid token from masking a branch partition mismatch. For example, a local `POS_BRANCH_ID=main-floor` should use cloud `POS_STORE_ID=main-floor`, and the local Platform Settings Store ID must also be `main-floor`.

`PUBLIC_BASE_URL` is the authoritative internet-facing origin and is normalized without a trailing slash. Render's trusted `RENDER_EXTERNAL_HOSTNAME` metadata is used only when the explicit value is absent. Do not use Render's internal `localhost` binding, and do not set `CLOUD_API_URL` on the cloud: the cloud server never starts the local outbound worker or synchronizes to itself.
