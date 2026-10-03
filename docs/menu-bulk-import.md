# Menu bulk import

Menu administrators can create or update a large menu from one Excel workbook instead of entering every item individually. The import uses a **preview then confirm** workflow: previewing performs no writes, and confirmation applies all accepted changes in one transaction.

## Workbook format

Upload an `.xlsx` file no larger than **5 MB** and with no more than **5,000 data rows**. The workbook must contain a worksheet named **Bulk Upload** whose first row includes these columns:

| Column | Required | Meaning |
| --- | --- | --- |
| `Name` | Yes | Menu item name. Within the file, the combination of category and item name identifies a row. |
| `Category` | Yes | Existing category name or a new category to create. |
| `Station` | Yes | Existing preparation station name/ID or a new station to create. |
| `Price` | Yes | Non-negative menu price. Use a number, not a formatted sentence or currency symbol. |

Keep a single header row, remove blank decorative rows, and use consistent spelling and capitalization for categories and stations. The importer reads the named worksheet, not whichever tab Excel last displayed.

## Preview and confirm

1. Sign in with menu-management permission and open **Menu admin**.
2. Select **Bulk Upload**, choose the workbook, and wait for validation.
3. Review the totals for categories, stations, created/updated/unchanged items, and invalid rows.
4. Use the preview filters and inspect every **Validation error**. A preview containing errors cannot be confirmed; correct the workbook and upload it again.
5. Review **Categories to create** and **Stations to create** carefully. A spelling variation can unintentionally create a second routing destination.
6. Select **Import _n_ Items** once. On success, use **View Menu** and verify representative prices, availability, categories, and preparation routing.

The preview token represents the validated workbook and expires after use or after its validity window. Changing the source workbook requires a new preview. Confirmation is atomic: if any write fails, categories, stations, and menu items from that confirmation are rolled back together.

## Existing items and synchronization

An existing item in the matched category is updated from the workbook; an identical row is reported as unchanged. Items absent from the workbook are **not deleted or hidden**. Availability, promotional state, descriptions, and historical transactions are not a substitute for reviewing the resulting menu in the UI.

In a local POS configured for cloud synchronization, a successful import queues menu sync events. The completion screen reports the queued count and synchronization message. Queued does not mean delivered: an administrator should check **Platform Settings → Cloud Synchronization**, run **Sync menu only** when appropriate, and confirm that the local and cloud menus converge under the same Store ID.

## Safety checklist

- Export or otherwise record the current production menu before a large change.
- Perform imports outside peak service and do not refresh or resubmit while confirmation is running.
- Treat category and station spelling as routing configuration, not display-only text.
- Place a test order for items routed to each affected station and verify KDS and printer output.
- If confirmation fails, read the error and preview the corrected workbook again; do not try to repair a partially imported menu because confirmation is transactional.
