# LAN Deployment Guide: One Server Host, Multiple POS Client Devices

This guide describes a restaurant-local deployment where one back-office/server machine runs the SYM POS backend and database, while cashier terminals, waiter tablets, kitchen displays, and bar displays connect over the restaurant LAN.

## Target topology

```text
[POS tablets / terminals / KDS screens]
              |
        Restaurant LAN / Wi-Fi
              |
   [Static IP or local DNS name]
              |
 [SYM POS server host + database]
```

- **Server host**: a wired machine on the restaurant LAN, preferably attached to UPS power, running the API, web assets, and database.
- **Client devices**: browsers or packaged frontend clients pointed at the server host URL.
- **Network**: private subnet only. Do not expose the POS service directly to the internet.

## Server host prerequisites

1. Assign a static DHCP lease or static IP to the server host, for example `192.168.10.10`.
2. Add a local DNS record such as `pos.local` if the router supports it.
3. Keep the server on wired Ethernet where possible.
4. Allow inbound LAN traffic only from the restaurant subnet to the POS HTTP(S) port.
5. Put the server, router/switch, and access points on UPS power to reduce mid-service outages.

## Required environment configuration

Set branch/location values on the server so every order, bill, stock movement, and report can be partitioned for future multi-branch reporting.

```env
POS_BRANCH_ID=main-dining
POS_BRANCH_NAME="Main Dining Branch"
POS_LOCATION_LABEL="Downtown / Ground Floor"

# LAN reconnect defaults. Tune only after observing real restaurant Wi-Fi behavior.
POS_RECONNECT_INITIAL_DELAY_MS=500
POS_RECONNECT_MAX_DELAY_MS=10000
POS_RECONNECT_JITTER_MS=250
POS_RETRY_MAX_SAFE_ATTEMPTS=6
POS_RETRY_MAX_UNSAFE_ATTEMPTS=1
POS_HEALTH_CHECK_INTERVAL_MS=5000
```

Guidance:

- Keep `POS_BRANCH_ID` stable forever for the same physical branch; changing it splits reporting history.
- Use a different `POS_BRANCH_ID` for every location, even when menus are identical.
- Keep the backend bind address on a LAN interface or reverse proxy listener reachable by client devices.

## Client device setup

1. Connect every POS client device to the restaurant LAN SSID or wired network.
2. Open the POS URL using the static host or local DNS name, for example `https://pos.local` or `http://192.168.10.10:3000`.
3. Bookmark the URL or pin it to the home screen.
4. Confirm each device can load login, menu, order, billing, kitchen, and report screens before service.
5. For tablets, disable aggressive battery/network sleep where the operating system allows it.

## Reconnect and retry behavior

Temporary Wi-Fi drops are expected during service. Clients must separate **connection recovery** from **operation retry safety**.

### Connection state

- A failed request, closed event stream, or missed health check moves the terminal into **degraded/offline** mode.
- The UI should keep the current screen visible and show a clear reconnecting banner.
- Clients should poll a lightweight health endpoint every `POS_HEALTH_CHECK_INTERVAL_MS` while degraded.
- After health succeeds, clients refresh authoritative state from the server before allowing new writes from stale screens.

### Backoff schedule

- First retry waits `POS_RECONNECT_INITIAL_DELAY_MS`.
- Each subsequent retry doubles the delay until `POS_RECONNECT_MAX_DELAY_MS`.
- Add random jitter up to `POS_RECONNECT_JITTER_MS` to prevent all terminals from reconnecting at once after an access point recovers.

### Retry-safe operations

Retry automatically only when the operation is safe to repeat:

- **Reads and refreshes**: retry up to `POS_RETRY_MAX_SAFE_ATTEMPTS`.
- **Writes with an idempotency key**: retry up to `POS_RETRY_MAX_SAFE_ATTEMPTS`; the server must treat duplicate keys as the same operation.
- **Writes without an idempotency key**: retry at most `POS_RETRY_MAX_UNSAFE_ATTEMPTS` and then require operator confirmation or a manual refresh.

Examples:

- Safe to auto-retry: loading menu, refreshing KDS queue, fetching an existing bill, submitting an order edit with an idempotency key.
- Not safe to repeatedly auto-retry: recording a cash payment without an idempotency key, voiding a bill, settling debt, or applying a discount.

### Conflict handling after reconnect

- Order edits use optimistic version checks; if the server version changed while a terminal was offline, the client must reload the order and ask the operator to reapply changes.
- Payment and debt workflows must refresh the bill before accepting another tender after reconnect.
- Kitchen/bar displays should discard locally stale progress snapshots and rehydrate from the server snapshot.

## Branch/location reporting separation

The database includes a `branches` table and branch foreign keys on core operational entities. Application records also carry `branchId` so report filters can default to the configured branch and later aggregate or compare multiple branches.

Minimum branch-scoped entities:

- users/staff assignment
- menu categories and menu items
- tables and table sessions
- orders, kitchen tickets, bills, bill splits, payments, and debt ledger entries
- inventory items and stock ledger entries
- promotions and audit logs

Reports should default to the configured `POS_BRANCH_ID`; multi-branch manager views can explicitly request a different branch or an aggregate mode once cross-branch permissions are added.

## Operational checklist

Before opening:

- Server host reachable by IP/local DNS from at least one cashier terminal and one KDS device.
- Branch environment variables are set and match the intended location.
- Test order reaches kitchen/bar screens.
- Test bill/receipt flow completes.
- Disconnect and reconnect a test tablet from Wi-Fi and verify the reconnect banner clears and data refreshes.

During service:

- If only one device drops, reconnect that device to Wi-Fi and let the client refresh.
- If all devices drop, check access point/router power first, then the server host.
- Avoid duplicate payment entry after outages; always refresh the bill before taking another payment.
