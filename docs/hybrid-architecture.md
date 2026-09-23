# Local-first hybrid deployment

## Boundaries

`APP_MODE=POS` uses only the restaurant PostgreSQL connection for operational requests. PostgreSQL triggers append changed shared records to `sync_outbox` in the same local transaction. The independently scheduled worker performs outbound HTTPS calls; errors are retained with exponential retry and never propagate into a cashier transaction. There is deliberately no cloud database fallback.

`APP_MODE=CLOUD` uses the cloud PostgreSQL connection and exposes three narrow interfaces:

* `/cloud/sync/*` authenticates a store worker with `SYNC_API_TOKEN`, mirrors allow-listed records, records processed event IDs, accepts heartbeats, and supplies customer-originated events.
* `/manager` and `/manager-api/*` are read-only. Deploy the cloud application with a manager PostgreSQL role that has `SELECT` only when hosting this surface separately; the application additionally rejects non-read HTTP methods.
* `/order` (also `/customergui`) and `/customer-api/*` expose available mirrored menu data and narrowly scoped account, pickup-request, and reservation operations. Production identity deployments should put OTP verification in front of account-sensitive status access.

Customer requests enter `incoming_pos_events`. The restaurant polls from inside its network, commits the event to `sync_inbox` and its local request table, and only then acknowledges it. Both queue directions have stable UUID keys, so an acknowledgement lost in transit results in a harmless retry rather than a duplicate.

## Cloud database roles

Provision distinct credentials rather than sharing the deployment owner:

```sql
CREATE ROLE pos_sync LOGIN PASSWORD '...';
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pos_sync;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO pos_sync;

CREATE ROLE pos_manager LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE restaurant_pos TO pos_manager;
GRANT USAGE ON SCHEMA public TO pos_manager;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO pos_manager;
GRANT INSERT, UPDATE ON repository_records, incoming_pos_events TO pos_manager;

CREATE ROLE pos_customer LOGIN PASSWORD '...';
GRANT SELECT ON menu_items, menu_categories, store_sync_status TO pos_customer;
GRANT SELECT, INSERT, UPDATE ON customer_web_accounts, online_orders, online_order_items, reservations, incoming_pos_events TO pos_customer;
```

Use separate cloud processes/connections for those roles where practical. Never expose either PostgreSQL database or a restaurant HTTP listener publicly; the restaurant needs outbound HTTPS and ordinary DNS only.

## Operations and resilience checks

Run migrations on both databases. Install the POS server/worker with the existing Windows service wrapper so it starts after PostgreSQL and restarts on failure without a visible console. Queue state lives in PostgreSQL and survives application and Windows restarts.

Before release, test with a staging cloud endpoint: disconnect WAN while retaining the LAN, exercise orders/payments/printing/inventory/customers/shifts, and confirm outbox growth; reconnect and compare stable IDs/counts. Repeat with the cloud service stopped. Submit online orders and reservations while the restaurant WAN is disconnected, reconnect, and verify one inbox/request row per event. Replay both HTTP batches and incoming events. Finally restart the application, worker, and Windows with pending rows and confirm automatic recovery. Pending, failed, and unprocessed records must never be included in retention cleanup.

Freshness is intentionally described as `CURRENT`, `DELAYED`, or `REMOTE STATUS UNKNOWN`: a stale heartbeat means cloud data is stale, not that the local POS has stopped.

## Selective bidirectional menu ownership

Only the application menu namespaces (`menu:categories` and `menu:items`) are bidirectional. Their stable ID, `updatedAt` UTC instant, `updatedSource`, optional actor/origin metadata, and `deletedAt` tombstone travel through the existing queues. Cloud manager writes use the explicit `menu:manage` capability and enqueue menu events; all cloud operational order, payment, refund, inventory-movement, and audit writes remain blocked. The manager database role receives writes only to the menu repository and incoming queue, not operational tables.

Menu conflicts use last-write-wins: a strictly newer trusted backend timestamp is applied, an older version is acknowledged as `STALE_IGNORED`, and an equal replay is `ALREADY_PROCESSED`. If two different changes have the exact same instant, fixed source priority (`CLOUD_MANAGER`, then `LOCAL_POS`) and a canonical-state fallback provide a deterministic tie-break. Applying a cloud menu event sets a transaction-local sync origin so the local repository trigger does not echo it into the outbox. Genuine later local edits still produce ordinary outbox events. Deletes are soft tombstones, so delayed updates cannot resurrect a record; a deliberately newer update can restore it.

Availability (`isAvailable`) is already edited through the POS menu administration workflow rather than inventory movements, so it follows the same bidirectional LWW rule. Stock quantities and inventory ledgers remain local-owned and one-way.

PostgreSQL stores these instants as `TIMESTAMPTZ`, and neither API accepts a browser-supplied version timestamp. Keep Windows automatic time synchronization enabled on restaurant hosts because reliable ordering between trusted local and cloud writes depends on correctly synchronized UTC clocks.
