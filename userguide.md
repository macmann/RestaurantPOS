# SYM POS User Guide / SYM POS အသုံးပြုသူလမ်းညွှန်

**Document purpose:** This is the day-to-day reference for restaurant staff using the SYM POS browser application. It explains what each workspace does, which role normally uses it, and how to complete a shift from sign-in through table closeout. Screen names and button labels are shown in **bold** so that they are easy to find.

**ရည်ရွယ်ချက်။** ဤစာတမ်းသည် SYM POS browser application ကို အသုံးပြုသည့် စားသောက်ဆိုင်ဝန်ထမ်းများအတွက် နေ့စဉ်ကိုးကားလမ်းညွှန် ဖြစ်ပါသည်။ Workspace တစ်ခုစီ၏ အသုံးဝင်ပုံ၊ ပုံမှန်အသုံးပြုသည့် role နှင့် sign-in ဝင်ချိန်မှ စားပွဲရှင်းပြီးသည်အထိ လုပ်ဆောင်ပုံတို့ ပါဝင်ပါသည်။ Screen နှင့် button အမည်များကို အလွယ်တကူရှာနိုင်ရန် **စာလုံးမည်း** ဖြင့် ပြထားပါသည်။

---

## English guide

### 1. Before you begin

You need:

- A current staff username (or email) and password from your manager.
- A supported browser on a device connected to the restaurant network.
- The POS address supplied by your manager, such as `http://192.168.1.25:8080/`. Use `http://localhost:8080/` only on the computer running SYM POS.
- The correct role for your duties. Missing screens usually mean your account does not have the required permission; this is not necessarily an error.

Do not share accounts, save a password on a shared device, or leave an active session unattended. Each action is associated with the signed-in user. Sign out when your shift ends.

### 2. Sign in, language, navigation, and connection status

#### Sign in

1. Open the POS address in your browser.
2. Enter **Username or email** and **Password**.
3. Select **Show** only when it is safe for people nearby to see the password.
4. Select **Sign in securely**.
5. If sign-in fails, check spelling and Caps Lock, then ask a manager to confirm that your account is active or reset your password. Do not repeatedly guess passwords.

After sign-in, SYM POS sends each role to its usual starting screen: waitstaff to **Order station**, cashier to **Billing**, kitchen/bar to **Prep boards**, inventory clerk to **Inventory alerts**, and other roles to **Dashboard**.

#### Navigate

- On a desktop, use the left sidebar. **Operations** contains shift work; **Administration** contains permitted setup and review tools.
- Use the `‹` / `›` control to collapse or expand the sidebar.
- On a phone or small tablet, use **Switch POS section** at the top. A tablet may also show role shortcuts.
- **Dashboard** summarizes the signed-in role and provides **Open** shortcuts.
- Select **Sign out** at the bottom of the sidebar when finished.

#### Change the application language

The default branch language is controlled by a superadmin in **Super admin panel → Localization**. Choose **English** or **Myanmar**, review/edit the English-to-Myanmar labels, and select **Save localization**. Saving changes the branch default for the application and receipt labels; other users may need to refresh or sign in again. Myanmar printing also requires suitable Myanmar fonts and a printer path capable of Unicode rendering—ask the system operator if printed glyphs are missing.

#### Read the network banner

| Banner | Meaning | What to do |
| --- | --- | --- |
| **Online — POS API reachable** | Normal operation. | Continue working. |
| **Degraded** | The browser is retrying or checking the POS server. | Wait briefly. Avoid pressing a payment/order button repeatedly. |
| **Offline** | The device cannot reach the POS server; orders and KDS updates are blocked. | Keep the page open, check Wi-Fi/LAN, and notify the shift lead. Resume only when **Online** returns. |

When a save reports a version conflict, another device changed the same order. Refresh/reopen the screen, review the latest values, and repeat the intended change once.

### 3. Roles and screen access

Permissions control both visible navigation and server actions. A user with more than one role receives the combined permissions.

| Role | Normal responsibilities |
| --- | --- |
| **Waitstaff** | Open tables, enter/edit open orders, monitor prep, view bills, and transition order items. |
| **Cashier** | Order entry, billing, cash collection, receipt printing, sales history, and table closeout. |
| **Kitchen / Bar** | Operate the relevant preparation board and move tickets to preparing/ready. |
| **Shift lead** | Service and billing closeout plus stock adjustments and operational exceptions. |
| **Inventory clerk** | Inventory masters, movements, alerts, and deduction policy. |
| **Manager / Admin** | Operational work plus menu, staff, reports, sales history, and audit review. |
| **Superadmin** | All functions, including system settings, localization, stations, and printers. |

If a guide section names a screen you cannot see, ask a manager to verify your role. Never use another employee's account to bypass access control.

### 4. Recommended shift workflow

#### Opening checks

1. Sign in using your own account and confirm that the network banner says **Online**.
2. Cashier: open **Billing** and confirm occupied tables/checks look correct.
3. Waitstaff: open **Order station** and review table availability.
4. Prep staff: open **Prep boards**, select the correct station, and verify the **Active orders** tab.
5. Manager: review **Inventory alerts**, printer status in **Super admin panel** (if permitted), and the floor layout.

#### During service

Follow this sequence: **open table → add items → save/print tickets → prepare → mark ready → take payment → print receipt → close paid table**. Do not close a table before its balance is zero.

#### Closing checks

1. Confirm no paid table remains open in **Billing**.
2. Check **Prep boards** for abandoned active tickets and resolve them with the shift lead.
3. Cashier/manager: compare **Sales history** or **Reports** with shift records.
4. Inventory staff: post wastage/restock movements with a clear reason.
5. Sign out on every shared device.

### 5. Table service and order entry

#### Start from Order station (recommended for waitstaff)

1. Open **Order station**.
2. Review the table tiles. Available tables are ready; occupied tables have an active session; inactive tables cannot be opened.
3. Select an available table.
4. Enter **Guests** (not greater than the configured capacity).
5. Select **Open table & order**. For an occupied table, select **Continue order** instead.

#### Use Table floor

**Table floor** presents the saved floor plan. Select an active table. If it is available, SYM POS opens it with an initial party count and takes you to **Order**; if occupied, it opens the existing order. An inactive table displays an instruction to reactivate it in **Table layout admin**.

#### Add and edit items in Order

1. Confirm the table name and guest count at the top.
2. In **Menu entry**, select an item to add it. Hidden/unavailable items are not offered for ordering.
3. Use `+` or `−` beside a line to change quantity. Reducing a quantity to zero removes that line.
4. Review **Customer ordered** and **Previous orders** carefully so a later round is not entered twice.
5. Select **Save order & print tickets**. This commits the order and routes items to their configured preparation stations/printers.
6. Wait for confirmation before leaving the screen. Do not double-click when the network is degraded.

Important rules:

- Select the correct table before adding anything. If the wrong table was used, stop and ask the shift lead to correct it before payment.
- Price and routing come from the menu configuration; report an incorrect price or station instead of compensating with unrelated items.
- A saved round appears in preparation progress. Use **Waiter progress** or **View order progress** to monitor it.

### 6. Preparation boards (KDS) and waiter progress

#### Kitchen/bar/prep staff

1. Open **Prep boards** and select the station button (for example **Kitchen** or **Bar**).
2. Keep **Active orders** selected during service.
3. Read the quantity, item, elapsed time, short order ID, destination/table, and note on every ticket.
4. Select **Start prep** when work actually begins.
5. Select **Mark ready** only when the entire displayed ticket quantity is ready for pickup.
6. Use **History** to review tickets already marked ready. History is a reference; it is not the active queue.

Never mark a ticket ready merely to clear the screen. If a ticket is duplicated, unclear, or assigned to the wrong station, contact the shift lead before preparing or discarding it.

#### Waitstaff

Open **Waiter progress** to see active items grouped by preparation station. The item state is typically queued/pending, preparing, ready, and then served as the workflow advances. Match the table/destination and short order ID before collecting food or drinks.

### 7. Billing, split bills, payment, receipts, and closeout

Only staff with billing-close permission can perform cashier actions. A view-only user sees disabled controls such as **Cashier prepares bill**.

#### Prepare a bill

1. Open **Billing**.
2. Under **Open checks**, select the occupied table.
3. Review guest count, items, quantities, subtotal, discount, tax, total, previous payments, and balance.
4. Before preparing the bill, choose the number of splits (up to the displayed A/B/C options) if guests need separate checks.
5. Select **Prepare bill for payment**.

#### Assign or change split items

1. In the split assignment view, assign each item/quantity to **Split A**, **B**, or **C**.
2. Use **Update split items** to save assignments.
3. Use **Merge splits** to return to one bill when required.
4. Select **Back** to return without proceeding.

Always verify that every item and quantity is assigned exactly as the guests requested. Splits may be printed separately with **Print Split A/B/C**.

#### Tax

Use **Mark tax exempt** only when the transaction legitimately qualifies and restaurant policy permits it. Use **Enable tax** to restore normal configured tax. If uncertain, call a manager; do not use tax exemption as a discount.

#### Take payment and close the table

1. Verify the active split and its remaining balance.
2. Select **Take cash payment** once for the amount shown. The current browser billing workflow records cash payments; do not use this button to represent an unrecorded card/wallet transfer.
3. Confirm that **Balance due** is zero. If a balance remains, resolve it before closeout.
4. Select **Print receipt** for a single bill, or the relevant **Print Split** button for split bills.
5. Review the print preview, including table, lines, discount, tax, and total. Select **Confirm print**, or **Cancel** to correct the bill first.
6. Select **Close paid table**. This closes the paid session and returns the table to availability.

Do not close a table until payment is confirmed and any required receipt has printed. If printing fails after payment, keep the table/bill open long enough to retry printing; never take the payment a second time simply to produce another receipt.

### 8. Sales history, reports, and audit

#### Sales history

Use **Sales history** to investigate completed sales:

1. Choose a **Quick filter**, grouping, **From**, and **To** date.
2. Select **Apply filter**.
3. Use **Items by category**, **Invoices**, or **Summary** tabs.
4. Review revenue, order count, quantity sold, invoice count/totals, and top items as applicable.

The report period follows saved transaction timestamps. Check the selected dates before assuming a transaction is missing.

#### Reports

**Reports** summarizes **Daily sales**, **Inventory usage**, and **Financial summary**, including revenue, gross profit, and gross margin. These figures are management references; report suspected configuration or cost errors rather than editing operational records to force a desired result.

#### Audit

1. Open **Audit**.
2. Enter an order ID, payment, user, action, or reason in **Search**; set a reasonable **Limit**.
3. Select **Search audit**.
4. Expand **Snapshots** to compare before/after details.

Audit data is sensitive. Use it only for authorized operational investigation.

### 9. Inventory

#### Understand alerts

**Inventory alerts** compares current balance with the item's minimum threshold. An alert is a prompt to verify and replenish stock, not proof that a physical count is correct.

#### Create an inventory item

Enter a unique **SKU**, descriptive **Name**, measurement **Unit** (for example `each`, `kg`, or `litre`), **Minimum**, and **Current stock**, then select **Create item**. Keep one consistent unit per item.

#### Post a movement

1. Find the inventory item.
2. Choose **Restock**, **Manual adjustment**, or **Wastage**.
3. Enter **Qty +/-** and a clear **Reason**.
4. Select **Post** and verify the new balance.

For wastage, enter the amount wasted; the application converts a positive wastage amount into a stock reduction. For a manual adjustment, use the sign needed to increase or decrease the balance. Never post a second movement just because the page responds slowly—refresh and verify the balance first.

#### Deduction policy

Authorized users may choose **When prep starts**, **When item completes**, or **Manual only**, then **Save policy**. Automatic deduction has an effect only when menu-to-inventory linking and item mappings are configured. Change this branch-wide policy only with management approval.

### 10. Menu administration

1. In **Create category**, enter a name and sort order, then **Add category**.
2. In **Create menu item**, choose its category, enter name and price, select the correct prep station, add an optional description, then **Add item**.
3. In the item list:
   - **Hide** removes an item from normal ordering without deleting its history; **Show** makes it available again.
   - **Make promo** / **Remove promo** changes its promotional flag.
   - Superadmins can **Edit** category/name/price/station/description or **Delete** an item.
4. Test one order after changing routing to confirm that the ticket reaches the correct board/printer.

Prefer **Hide** for temporarily unavailable products. **Delete** is irreversible and should be reserved for erroneous/unused records after checking with management.

### 11. Table layout administration

#### Add a table

Enter **Name**, **Capacity**, **Layout X %**, **Layout Y %**, and **Status**, then select **Add to floor**. Use a unique, recognizable dining-room name.

#### Arrange and maintain the floor

- Drag a table on the **Floor plan builder**; the X/Y fields stay in sync and the position saves after the move.
- Use `−`, **Fit**, and `+` to adjust the canvas view.
- In **Table configuration**, edit name, seats, coordinates, or status, then **Save**.
- Set a table **Inactive** when it should remain in history but must not accept service.
- Use **Remove** only for an unused table. An active/open table may need its session resolved first.

### 12. Staff and system administration

#### Create and maintain staff

1. Open **Staff & settings**, or the staff area in **Super admin panel**.
2. Enter an optional **User ID**, required **Username**, optional email, an initial password of at least 8 characters, role, and branch.
3. Select **Create profile**.
4. In **Staff directory**, change a role and/or enter a new password, then **Save**.
5. Use **Deactivate** immediately when access must stop; use **Activate** only after authorization.

Give the least privilege needed. Use separate accounts, communicate initial passwords privately, and require staff to protect them. Be especially careful when changing your own superadmin account.

#### Super admin panel

The panel shows staff counts, branch identity, and live printer cards. It also provides:

- **Add station, KDS board & printer** for a quick station/device record.
- **Enable menu–inventory linking** to connect configured menu sales to inventory behavior.
- **Localization** for English/Myanmar defaults and labels.
- A settings menu for full **Bill & printer settings** and **Localization**.

### 13. Bill, prep station, and printer settings

These settings affect the whole branch. Make changes outside peak service and test afterward.

#### Receipt identity and tax

Enter restaurant name, address, contact, optional tax/registration ID, and optional footer. Configure whether tax is enabled and its rate according to restaurant policy. Review the receipt preview before saving.

#### Prep stations

For each station, maintain its display name, sort order, enabled state, and **Send tickets to** printer assignment. Station IDs are stable routing keys and are read-only after creation. Disabling a board removes it from normal use; re-route menu items before disabling a live station.

#### Printers

For each printer/device set:

- **Printer ID** and a clear display name.
- Connection: **Simulator / test**, **Windows installed printer (USB)**, or **Wireless / LAN (TCP)**.
- For Windows, the exact Windows printer queue name.
- For network printing, the printer IP/hostname and port (commonly `9100`, if that device uses raw TCP).
- Copies, **Enabled**, and **Automatic jobs**.

Assign the receipt operation and every prep station to the intended device, save settings, then check printer status and run a real test ticket/receipt. **Simulator** is for testing and does not produce a physical print. If Myanmar characters print as boxes, contact the operator to verify Myanmar fonts and Unicode-capable printing.

### 14. Troubleshooting reference

| Problem | Safe response |
| --- | --- |
| Cannot sign in | Check identifier, password, Caps Lock, and POS address. Ask a manager whether the account is active. |
| A screen/menu is missing | Your role may not have permission. Ask a manager; do not borrow an account. |
| Offline/degraded banner | Stop repeated submissions, check LAN/Wi-Fi, wait for Online, then verify whether the action saved. |
| Table appears occupied unexpectedly | Open the table and review its existing order/bill. Do not create a substitute table to hide the open session. |
| Item is absent from menu | It may be hidden, in a missing category, or unavailable. Ask a menu manager. |
| Wrong price or prep station | Stop before sending if possible; report it to menu admin. Verify any correction on the ticket. |
| KDS ticket not visible | Confirm the item was saved, correct station is selected, **Active orders** is open, and network is Online. Then check item routing. |
| Payment button disabled | You may lack cashier permission, no bill is prepared, or no positive balance remains. |
| Close table disabled | The bill still has a balance or your role cannot close it. Resolve payment or call a cashier/manager. |
| Receipt did not print | Do not charge again. Keep/reopen the preview if possible, check enabled/status/connection/paper, and retry once after correction. |
| Duplicate-looking transaction | Stop. Compare order IDs, bill payments, Sales history, and Audit before taking or voiding money. Escalate to a manager. |
| Inventory balance seems wrong | Do a physical check, review recent movements/audit, and post one documented correction only when authorized. |
| Changes conflict or disappear | Another terminal may have saved first. Refresh, review the latest record, and reapply only the missing change. |

When escalating, record the time, signed-in user, table, order/bill short ID, exact message, and what button was pressed. Do not include passwords in notes or screenshots.

### 15. Quick-reference checklists

**Waitstaff:** Online → select/open correct table → enter guests → add/review items → **Save order & print tickets** → monitor **Waiter progress** → deliver to correct table.

**Prep staff:** Correct station → **Active orders** → read quantity/destination/note → **Start prep** → make item → **Mark ready**.

**Cashier:** Select open check → review → choose/assign splits → prepare bill → verify balance → **Take cash payment** once → print/confirm → balance zero → **Close paid table**.

**Manager:** Review access and alerts → supervise exceptions → validate sales/reports/audit → verify open bills/tickets → ensure shared devices are signed out.

---

## မြန်မာဘာသာ လမ်းညွှန်

### ၁။ အသုံးမပြုမီ လိုအပ်ချက်များ

- မန်နေဂျာထံမှ ရရှိထားသော လက်ရှိအသုံးပြုနိုင်သည့် username (သို့) email နှင့် password လိုအပ်ပါသည်။
- စားသောက်ဆိုင် network ချိတ်ထားသော device နှင့် သင့်တော်သည့် browser လိုအပ်ပါသည်။
- မန်နေဂျာပေးထားသော POS လိပ်စာ (ဥပမာ `http://192.168.1.25:8080/`) ကိုသုံးပါ။ SYM POS server တင်ထားသည့်စက်ပေါ်တွင်သာ `http://localhost:8080/` ကို သုံးရပါမည်။
- မိမိတာဝန်နှင့် ကိုက်ညီသော role ရှိရပါမည်။ Screen တစ်ခုမပေါ်ခြင်းသည် အများအားဖြင့် permission မရှိခြင်းဖြစ်ပြီး system error ဖြစ်ချင်မှဖြစ်ပါသည်။

Account မျှဝေခြင်း၊ အများသုံးစက်တွင် password သိမ်းခြင်း၊ sign-in ဝင်ထားသည့်စက်ကို ပိုင်ရှင်မဲ့ထားခြင်း မပြုပါနှင့်။ လုပ်ဆောင်ချက်တိုင်းကို sign-in ဝင်ထားသူနှင့် မှတ်တမ်းတင်ထားပါသည်။ အလုပ်ချိန်ပြီးလျှင် sign out လုပ်ပါ။

### ၂။ Sign in၊ ဘာသာစကား၊ navigation နှင့် network အခြေအနေ

#### Sign in ဝင်ရန်

1. Browser မှ POS လိပ်စာကို ဖွင့်ပါ။
2. **Username or email** နှင့် **Password** ထည့်ပါ။
3. အနီးအနားရှိသူများ password မြင်နိုင်ခြင်းမရှိမှသာ **Show** ကို နှိပ်ပါ။
4. **Sign in securely** ကို နှိပ်ပါ။
5. မဝင်နိုင်ပါက စာလုံးပေါင်းနှင့် Caps Lock ကို စစ်ပါ။ ထို့နောက် account active ဖြစ်/မဖြစ် သို့မဟုတ် password reset လုပ်ရန် မန်နေဂျာကို မေးပါ။ Password ကို ဆက်တိုက်မခန့်မှန်းပါနှင့်။

Sign-in ပြီးလျှင် waitstaff ကို **Order station**၊ cashier ကို **Billing**၊ kitchen/bar ကို **Prep boards**၊ inventory clerk ကို **Inventory alerts**၊ အခြား role များကို **Dashboard** သို့ ပုံမှန်ပို့ပေးပါသည်။

#### Screen ပြောင်းရန်

- Desktop တွင် ဘယ်ဘက် sidebar ကို သုံးပါ။ **Operations** တွင် အလုပ်ချိန်အတွင်းလုပ်ရမည့်အရာများ၊ **Administration** တွင် မိမိခွင့်ရှိသည့် ပြင်ဆင်/စစ်ဆေးမှုများ ရှိပါသည်။
- `‹` / `›` ကို နှိပ်၍ sidebar ကို ခေါက်/ဖြန့်နိုင်ပါသည်။
- ဖုန်း သို့မဟုတ် tablet အသေးတွင် အပေါ်ဘက် **Switch POS section** ကို သုံးပါ။ Tablet တွင် role shortcut များလည်း ပေါ်နိုင်ပါသည်။
- **Dashboard** တွင် မိမိ role အကျဉ်းချုပ်နှင့် **Open** shortcut များ ရှိပါသည်။
- ပြီးဆုံးလျှင် sidebar အောက်ရှိ **Sign out** ကို နှိပ်ပါ။

#### ဘာသာစကား ပြောင်းရန်

Superadmin သည် **Super admin panel → Localization** မှ branch default ဘာသာစကားကို သတ်မှတ်ပါသည်။ **English** သို့မဟုတ် **Myanmar** ရွေးပြီး English-to-Myanmar label များကို စစ်/ပြင်ကာ **Save localization** နှိပ်ပါ။ Application နှင့် receipt label default ပြောင်းသွားပြီး အခြားအသုံးပြုသူများ refresh သို့မဟုတ် sign-in ပြန်ဝင်ရန် လိုနိုင်ပါသည်။ မြန်မာစာပုံနှိပ်ရန် သင့်တော်သည့် Myanmar font နှင့် Unicode ရသည့် printer လမ်းကြောင်းလိုပါသည်။ စာလုံးမမှန်ပါက system operator ကို အကြောင်းကြားပါ။

#### Network banner ကို နားလည်ရန်

| Banner | အဓိပ္ပာယ် | လုပ်ဆောင်ရန် |
| --- | --- | --- |
| **Online — POS API reachable** | ပုံမှန်အလုပ်လုပ်နေသည်။ | ဆက်လက်အသုံးပြုပါ။ |
| **Degraded** | Browser က POS server ကို ပြန်ချိတ်/စစ်နေသည်။ | ခဏစောင့်ပါ။ Payment/order button ကို ထပ်ခါတလဲလဲ မနှိပ်ပါနှင့်။ |
| **Offline** | POS server မရောက်နိုင်ပါ။ Order နှင့် KDS update ပိတ်ထားသည်။ | Page မပိတ်ဘဲ Wi-Fi/LAN စစ်ပြီး shift lead ကို အသိပေးပါ။ **Online** ပြန်ဖြစ်မှ ဆက်လုပ်ပါ။ |

Version conflict ပေါ်ပါက အခြား device က ထို order ကို ပြင်ပြီးဖြစ်နိုင်ပါသည်။ Screen ကို refresh/reopen လုပ်၊ နောက်ဆုံးတန်ဖိုးများ စစ်ပြီး လိုအပ်သည့်ပြင်ဆင်မှုကို တစ်ကြိမ်သာ ထပ်လုပ်ပါ။

### ၃။ Role နှင့် အသုံးပြုခွင့်

| Role | ပုံမှန်တာဝန် |
| --- | --- |
| **Waitstaff** | စားပွဲဖွင့်၊ open order ထည့်/ပြင်၊ ပြင်ဆင်မှုကို စောင့်ကြည့်၊ bill ကြည့်နှင့် item status ပြောင်းခြင်း။ |
| **Cashier** | Order၊ billing၊ cash လက်ခံ၊ receipt ထုတ်၊ sales history ကြည့်နှင့် စားပွဲပိတ်ခြင်း။ |
| **Kitchen / Bar** | သက်ဆိုင်ရာ prep board ကို ကြည့်ပြီး ticket ကို preparing/ready ပြောင်းခြင်း။ |
| **Shift lead** | Service/billing closeout၊ stock adjustment နှင့် ချွင်းချက်များကို ကြီးကြပ်ခြင်း။ |
| **Inventory clerk** | Inventory item၊ movement၊ alert နှင့် deduction policy ကို စီမံခြင်း။ |
| **Manager / Admin** | လုပ်ငန်းဆောင်ရွက်မှုအပြင် menu၊ staff၊ report၊ sales history နှင့် audit စစ်ခြင်း။ |
| **Superadmin** | System setting၊ localization၊ station နှင့် printer အပါအဝင် အားလုံး။ |

လမ်းညွှန်တွင် ပါသော screen ကို မမြင်ရပါက မန်နေဂျာထံ role စစ်ဆေးခိုင်းပါ။ Access ကျော်ရန် အခြားသူ account ကို မသုံးပါနှင့်။

### ၄။ အလုပ်ချိန်အစမှ အဆုံးအထိ အကြံပြုအစီအစဉ်

#### အလုပ်စမီ

1. မိမိ account ဖြင့် sign in ဝင်ပြီး banner **Online** ဖြစ်ကြောင်း စစ်ပါ။
2. Cashier သည် **Billing** တွင် occupied table/open check မှန်ကန်မှု စစ်ပါ။
3. Waitstaff သည် **Order station** တွင် စားပွဲအခြေအနေ စစ်ပါ။
4. Prep staff သည် **Prep boards** တွင် မိမိ station နှင့် **Active orders** tab မှန်ကန်မှု စစ်ပါ။
5. Manager သည် **Inventory alerts**၊ ခွင့်ရှိပါက **Super admin panel** ရှိ printer status နှင့် floor layout ကို စစ်ပါ။

#### Service အတွင်း

**စားပွဲဖွင့် → item ထည့် → save/ticket ပုံနှိပ် → ပြင်ဆင် → ready လုပ် → ငွေလက်ခံ → receipt ပုံနှိပ် → paid table ပိတ်** အစီအစဉ်အတိုင်း လုပ်ပါ။ Balance သုညမဖြစ်မီ စားပွဲမပိတ်ပါနှင့်။

#### အလုပ်ပြီးချိန်

1. **Billing** တွင် paid ဖြစ်ပြီး မပိတ်ရသေးသည့် စားပွဲမရှိကြောင်း စစ်ပါ။
2. **Prep boards** တွင် မပြီးသေးသည့် ticket ရှိပါက shift lead နှင့် ဖြေရှင်းပါ။
3. Cashier/manager သည် **Sales history** သို့မဟုတ် **Reports** နှင့် shift စာရင်း တိုက်စစ်ပါ။
4. Inventory staff သည် wastage/restock ကို ရှင်းလင်းသော reason နှင့် မှတ်တမ်းတင်ပါ။
5. အများသုံး device အားလုံးမှ sign out လုပ်ပါ။

### ၅။ စားပွဲဖွင့်ခြင်းနှင့် Order ထည့်ခြင်း

#### Order station မှ စရန်

1. **Order station** ဖွင့်ပါ။
2. Table tile များကို ကြည့်ပါ။ Available သည် အဆင်သင့်၊ occupied သည် active session ရှိပြီး inactive table ကို မဖွင့်နိုင်ပါ။
3. Available table ကို ရွေးပါ။
4. Capacity ထက်မကျော်သော **Guests** အရေအတွက် ထည့်ပါ။
5. **Open table & order** နှိပ်ပါ။ Occupied ဖြစ်ပါက **Continue order** နှိပ်ပါ။

#### Table floor မှ အသုံးပြုရန်

**Table floor** တွင် သိမ်းထားသည့် floor plan ပေါ်ပါသည်။ Active table ကို ရွေးပါ။ Available ဖြစ်ပါက စားပွဲဖွင့်ပြီး **Order** သို့ ပို့ပါမည်။ Occupied ဖြစ်ပါက ရှိပြီးသား order ဖွင့်ပါမည်။ Inactive table ဖြစ်ပါက **Table layout admin** မှ reactivate လုပ်ရန် သတိပေးပါမည်။

#### Item ထည့်/ပြင်ရန်

1. အပေါ်ဘက် table name နှင့် guest count မှန်ကြောင်း စစ်ပါ။
2. **Menu entry** ရှိ item ကို နှိပ်၍ ထည့်ပါ။ Hidden/unavailable item ကို order မတင်နိုင်ပါ။
3. Line ဘေး `+` / `−` ဖြင့် quantity ပြင်ပါ။ Quantity သုညအထိ လျှော့လျှင် line ကို ဖယ်ရှားပါမည်။
4. နောက်ထပ် round ကို နှစ်ကြိမ်မထည့်မိစေရန် **Customer ordered** နှင့် **Previous orders** ကို စစ်ပါ။
5. **Save order & print tickets** ကို နှိပ်ပါ။ Order သိမ်းပြီး item ကို သတ်မှတ် prep station/printer သို့ ပို့ပါမည်။
6. အတည်ပြုချက်ရမှ screen မှ ထွက်ပါ။ Network degraded ဖြစ်ချိန် double-click မလုပ်ပါနှင့်။

စားပွဲမှန်ကြောင်း အရင်စစ်ပါ။ မှားသည့် table သို့ order တင်မိပါက payment မလုပ်မီ ရပ်ပြီး shift lead ကို ခေါ်ပါ။ ဈေးနှုန်းနှင့် routing ကို menu configuration မှ သတ်မှတ်သောကြောင့် မှားပါက အခြား item ဖြင့် ချိန်ညှိမည့်အစား တာဝန်ရှိသူကို အကြောင်းကြားပါ။

### ၆။ Prep boards (KDS) နှင့် Waiter progress

#### Kitchen/Bar/Prep staff

1. **Prep boards** ဖွင့်ပြီး သက်ဆိုင်ရာ station (ဥပမာ **Kitchen**, **Bar**) ကို ရွေးပါ။
2. Service အတွင်း **Active orders** tab ကိုထားပါ။
3. Ticket တစ်ခုစီ၏ quantity၊ item၊ ကြာချိန်၊ order ID အတို၊ table/destination နှင့် note ကို ဖတ်ပါ။
4. အမှန်တကယ် စပြင်ချိန် **Start prep** နှိပ်ပါ။
5. ပြထားသော quantity အားလုံး pickup အဆင်သင့်မှသာ **Mark ready** နှိပ်ပါ။
6. Ready လုပ်ပြီး ticket များကို **History** မှ ပြန်ကြည့်နိုင်ပါသည်။ History သည် active queue မဟုတ်ပါ။

Screen ရှင်းလိုသောကြောင့် ready မလုပ်ပါနှင့်။ Ticket ထပ်နေ၊ မရှင်းလင်း၊ station မှားနေပါက ပြင်ဆင်/ပယ်ဖျက်မီ shift lead ကို ခေါ်ပါ။

#### Waitstaff

**Waiter progress** တွင် station အလိုက် active item များကို ကြည့်ပါ။ ပုံမှန်အားဖြင့် queued/pending → preparing → ready → served အဖြစ် ပြောင်းပါသည်။ အစားအသောက်/အဖျော်ယမကာ ယူမီ table/destination နှင့် order ID အတိုကို တိုက်စစ်ပါ။

### ၇။ Billing၊ bill ခွဲခြင်း၊ ငွေလက်ခံခြင်းနှင့် receipt

Cashier action များကို billing-close permission ရှိသူသာ လုပ်နိုင်ပါသည်။ View-only user တွင် **Cashier prepares bill** ကဲ့သို့ control များ disabled ဖြစ်နေပါမည်။

#### Bill ပြင်ဆင်ရန်

1. **Billing** ဖွင့်ပါ။
2. **Open checks** အောက်မှ occupied table ရွေးပါ။
3. Guest count၊ item/quantity၊ subtotal၊ discount၊ tax၊ total၊ ယခင် payment နှင့် balance ကို စစ်ပါ။
4. ဧည့်သည်များ bill ခွဲလိုပါက prepare မလုပ်မီ ပြထားသော A/B/C split အရေအတွက် ရွေးပါ။
5. **Prepare bill for payment** နှိပ်ပါ။

#### Split item သတ်မှတ်/ပြင်ရန်

1. Item/quantity တစ်ခုစီကို **Split A**, **B** သို့မဟုတ် **C** သို့ သတ်မှတ်ပါ။
2. **Update split items** ဖြင့် သိမ်းပါ။
3. Bill တစ်စောင်တည်း ပြန်လုပ်ရန် **Merge splits** သုံးပါ။
4. နောက်ပြန်ရန် **Back** ကို သုံးပါ။

Item နှင့် quantity အားလုံး ဧည့်သည်တောင်းသလို အတိအကျခွဲထားကြောင်း စစ်ပါ။ **Print Split A/B/C** ဖြင့် split တစ်ခုစီ သီးခြားပုံနှိပ်နိုင်ပါသည်။

#### Tax

အမှန်တကယ် tax-exempt ဖြစ်ပြီး ဆိုင် policy ခွင့်ပြုမှသာ **Mark tax exempt** ကို သုံးပါ။ ပုံမှန် tax ပြန်ဖွင့်ရန် **Enable tax** သုံးပါ။ မသေချာပါက မန်နေဂျာကို မေးပါ။ Tax exemption ကို discount အဖြစ် မသုံးပါနှင့်။

#### ငွေလက်ခံပြီး စားပွဲပိတ်ရန်

1. Active split နှင့် လက်ကျန် balance စစ်ပါ။
2. ပြထားသောငွေပမာဏအတွက် **Take cash payment** ကို တစ်ကြိမ်သာ နှိပ်ပါ။ လက်ရှိ browser workflow သည် cash payment ကို မှတ်တမ်းတင်ပါသည်။ Card/wallet transfer ကို မမှတ်တမ်းတင်ဘဲ cash အဖြစ် မနှိပ်ပါနှင့်။
3. **Balance due** သုညဖြစ်ကြောင်း စစ်ပါ။ လက်ကျန်ရှိပါက မပိတ်မီ ဖြေရှင်းပါ။
4. Bill တစ်ခုတည်းအတွက် **Print receipt**၊ split bill အတွက် သက်ဆိုင်ရာ **Print Split** ကို နှိပ်ပါ။
5. Print preview တွင် table၊ line၊ discount၊ tax နှင့် total စစ်ပါ။ မှန်လျှင် **Confirm print**၊ ပြင်ရန် **Cancel** နှိပ်ပါ။
6. **Close paid table** နှိပ်ပါ။ Paid session ပိတ်ပြီး table ပြန် available ဖြစ်ပါမည်။

Payment အတည်ပြုပြီး လိုအပ်သည့် receipt ထွက်မှ စားပွဲပိတ်ပါ။ Payment ပြီးနောက် printer မထွက်ပါက ထပ်ပုံနှိပ်နိုင်ရန် bill ကို ခဏဖွင့်ထားပါ။ Receipt ပြန်ထုတ်လို၍ payment ကို ဒုတိယအကြိမ် မယူပါနှင့်။

### ၈။ Sales history၊ Reports နှင့် Audit

#### Sales history

1. **Quick filter**၊ grouping၊ **From** နှင့် **To** date ရွေးပါ။
2. **Apply filter** နှိပ်ပါ။
3. **Items by category**, **Invoices** သို့မဟုတ် **Summary** tab ကို ရွေးပါ။
4. Revenue၊ order count၊ quantity sold၊ invoice count/total နှင့် top item ကို စစ်ပါ။

Transaction မတွေ့ဟု မယူဆမီ ရွေးထားသော ရက်စွဲမှန်ကြောင်း စစ်ပါ။

#### Reports

**Reports** တွင် **Daily sales**, **Inventory usage**, **Financial summary** (revenue၊ gross profit၊ gross margin အပါအဝင်) ပေါ်ပါသည်။ ကိန်းဂဏန်းမှားသည်ဟု သံသယရှိပါက လိုချင်သည့်ရလဒ်ရရန် record မပြင်ဘဲ configuration/cost ကို တာဝန်ရှိသူထံ တင်ပြပါ။

#### Audit

1. **Audit** ဖွင့်ပါ။
2. **Search** တွင် order ID၊ payment၊ user၊ action သို့မဟုတ် reason ထည့်ပြီး သင့်တော်သော **Limit** သတ်မှတ်ပါ။
3. **Search audit** နှိပ်ပါ။
4. **Snapshots** ဖြန့်၍ before/after ကို နှိုင်းယှဉ်ပါ။

Audit data သည် အရေးကြီးသည့် အချက်အလက်ဖြစ်၍ ခွင့်ပြုထားသော လုပ်ငန်းစစ်ဆေးမှုအတွက်သာ သုံးပါ။

### ၉။ Inventory

#### Alert ကို နားလည်ရန်

**Inventory alerts** သည် current balance နှင့် minimum threshold ကို နှိုင်းယှဉ်ပါသည်။ Alert သည် stock စစ်ပြီး ဖြည့်ရန် အချက်ပေးခြင်းဖြစ်ပြီး မြေပြင် count အတိအကျဖြစ်ကြောင်း အာမခံခြင်းမဟုတ်ပါ။

#### Inventory item ဖန်တီးရန်

မတူညီသော **SKU**၊ ရှင်းလင်းသော **Name**၊ **Unit** (`each`, `kg`, `litre` စသည်)၊ **Minimum** နှင့် **Current stock** ထည့်ပြီး **Create item** နှိပ်ပါ။ Item တစ်မျိုးအတွက် unit တစ်မျိုးတည်းကို အမြဲသုံးပါ။

#### Movement တင်ရန်

1. Item ကို ရှာပါ။
2. **Restock**, **Manual adjustment** သို့မဟုတ် **Wastage** ရွေးပါ။
3. **Qty +/-** နှင့် ရှင်းလင်းသော **Reason** ထည့်ပါ။
4. **Post** နှိပ်ပြီး balance အသစ်ကို စစ်ပါ။

Wastage အတွက် ပျက်စီး/ဆုံးရှုံးသည့် ပမာဏကို အပေါင်းကိန်းဖြင့် ထည့်နိုင်ပြီး application က stock လျှော့ပေးပါသည်။ Manual adjustment တွင် တိုး/လျှော့ရန် သင့်တော်သည့် sign သုံးပါ။ Page နှေးသောကြောင့် movement ထပ်မတင်ပါနှင့်—refresh လုပ်ပြီး balance အရင်စစ်ပါ။

#### Deduction policy

ခွင့်ရှိသူသည် **When prep starts**, **When item completes** သို့မဟုတ် **Manual only** ရွေးပြီး **Save policy** နှိပ်နိုင်ပါသည်။ Menu–inventory linking နှင့် item mapping ပြင်ဆင်ထားမှ automatic deduction အကျိုးသက်ရောက်ပါသည်။ Branch တစ်ခုလုံးအတွက် policy ဖြစ်သောကြောင့် management ခွင့်ပြုချက်မရှိဘဲ မပြောင်းပါနှင့်။

### ၁၀။ Menu administration

1. **Create category** တွင် name/sort order ထည့်ပြီး **Add category** နှိပ်ပါ။
2. **Create menu item** တွင် category၊ name၊ price၊ မှန်ကန်သည့် prep station နှင့် optional description ထည့်ပြီး **Add item** နှိပ်ပါ။
3. Item list တွင်:
   - **Hide** သည် history မဖျက်ဘဲ order menu မှ ယာယီဖယ်ပါသည်။ **Show** ဖြင့် ပြန်ဖွင့်ပါသည်။
   - **Make promo** / **Remove promo** ဖြင့် promotional flag ပြောင်းပါသည်။
   - Superadmin သည် **Edit** ဖြင့် အချက်အလက်ပြင်၊ **Delete** ဖြင့် item ဖျက်နိုင်ပါသည်။
4. Routing ပြောင်းပြီးလျှင် စမ်းသပ် order တစ်ခုဖြင့် board/printer မှန်ကန်မှု စစ်ပါ။

ယာယီကုန်နေသော item အတွက် **Hide** ကို သုံးပါ။ **Delete** သည် ပြန်မရသောကြောင့် မှားယွင်း/မသုံးသည့် record ကို management နှင့် စစ်ပြီးမှသာ သုံးပါ။

### ၁၁။ Table layout administration

#### Table ထည့်ရန်

**Name**, **Capacity**, **Layout X %**, **Layout Y %**, **Status** ထည့်ပြီး **Add to floor** နှိပ်ပါ။ Dining room တွင် အလွယ်တကူခွဲခြားနိုင်သည့် ထူးခြားသောအမည် သုံးပါ။

#### Floor ကို စီမံရန်

- **Floor plan builder** တွင် table ကို ဆွဲရွှေ့နိုင်ပြီး X/Y field များ လိုက်ပြောင်းကာ နေရာကို သိမ်းပါသည်။
- `−`, **Fit**, `+` ဖြင့် canvas မြင်ကွင်း ချိန်ပါ။
- **Table configuration** တွင် name၊ seats၊ coordinate၊ status ပြင်ပြီး **Save** နှိပ်ပါ။
- History ကို ထိန်းထားပြီး service လက်မခံစေလိုပါက **Inactive** ပြုလုပ်ပါ။
- မသုံးသည့် table ကိုသာ **Remove** လုပ်ပါ။ Active/open table ဖြစ်ပါက session ကို အရင်ဖြေရှင်းရန် လိုနိုင်ပါသည်။

### ၁၂။ Staff နှင့် System administration

#### Staff account စီမံရန်

1. **Staff & settings** သို့မဟုတ် **Super admin panel** ရှိ staff area ကို ဖွင့်ပါ။
2. Optional **User ID**၊ လိုအပ်သော **Username**၊ optional email၊ အနည်းဆုံး ၈ လုံးရှိ initial password၊ role နှင့် branch ထည့်ပါ။
3. **Create profile** နှိပ်ပါ။
4. **Staff directory** တွင် role ပြောင်း/ password အသစ်ထည့်ပြီး **Save** နှိပ်ပါ။
5. Access ရပ်ရန်လိုချိန် **Deactivate** ချက်ချင်းလုပ်ပါ။ ခွင့်ပြုချက်ရမှ **Activate** ပြန်လုပ်ပါ။

တာဝန်အတွက် လိုအပ်သမျှ permission သာပေးပါ။ Account သီးခြားသုံး၊ initial password ကို လုံခြုံစွာပေးပြီး password ကာကွယ်ရန် သတိပေးပါ။ မိမိ superadmin account ပြင်ရာတွင် အထူးသတိပြုပါ။

#### Super admin panel

Panel တွင် staff count၊ branch identity နှင့် live printer card များပေါ်ပြီး အောက်ပါတို့ ပါဝင်ပါသည်။

- **Add station, KDS board & printer** — station/device record အမြန်ထည့်ရန်။
- **Enable menu–inventory linking** — ပြင်ဆင်ထားသော menu sale နှင့် inventory ကို ချိတ်ရန်။
- **Localization** — English/Myanmar default နှင့် label များ။
- Full **Bill & printer settings** နှင့် **Localization** သို့ settings menu။

### ၁၃။ Bill၊ Prep station နှင့် Printer settings

ဤ setting များသည် branch တစ်ခုလုံးကို သက်ရောက်ပါသည်။ လူများသောအချိန်ပြင်ပတွင် ပြောင်းပြီး စမ်းသပ်ပါ။

#### Receipt identity နှင့် tax

Restaurant name၊ address၊ contact၊ optional tax/registration ID နှင့် footer ထည့်ပါ။ ဆိုင် policy အတိုင်း tax enabled/rate သတ်မှတ်ပါ။ မသိမ်းမီ receipt preview ကို စစ်ပါ။

#### Prep station

Station တစ်ခုစီ၏ display name၊ sort order၊ enabled state နှင့် **Send tickets to** printer assignment ကို ထိန်းသိမ်းပါ။ Station ID သည် routing key ဖြစ်ပြီး ဖန်တီးပြီးနောက် read-only ဖြစ်ပါသည်။ Live station ပိတ်မည်ဆိုပါက menu item များကို အရင် reroute လုပ်ပါ။

#### Printer

Printer/device တစ်ခုစီအတွက်:

- **Printer ID** နှင့် ရှင်းလင်းသော display name ထည့်ပါ။
- **Simulator / test**, **Windows installed printer (USB)** သို့မဟုတ် **Wireless / LAN (TCP)** connection ရွေးပါ။
- Windows printer ဖြစ်ပါက Windows တွင်ရှိသည့် queue name အတိအကျ ထည့်ပါ။
- Network printer ဖြစ်ပါက IP/hostname နှင့် port (raw TCP သုံးသည့် device များတွင် `9100` ဖြစ်လေ့ရှိ) ထည့်ပါ။
- Copies၊ **Enabled** နှင့် **Automatic jobs** ကို သတ်မှတ်ပါ။

Receipt နှင့် prep station တစ်ခုစီကို သင့်တော်သော device သို့ assign လုပ်၊ save ပြီး printer status စစ်ကာ တကယ့် test ticket/receipt ထုတ်ပါ။ **Simulator** သည် စမ်းသပ်ရန်သာဖြစ်ပြီး စာရွက်မထွက်ပါ။ မြန်မာစာ လေးထောင့်ကွက်ဖြစ်ပါက Myanmar font နှင့် Unicode printing ကို operator ထံ စစ်ခိုင်းပါ။

### ၁၄။ ပြဿနာဖြေရှင်းရန် အမြန်ကိုးကားချက်

| ပြဿနာ | လုံခြုံသော ဖြေရှင်းပုံ |
| --- | --- |
| Sign in မဝင်နိုင် | Identifier/password/Caps Lock/POS address စစ်ပြီး account active ဖြစ်/မဖြစ် မန်နေဂျာကို မေးပါ။ |
| Screen/menu မပေါ် | Role permission မရှိနိုင်ပါ။ မန်နေဂျာကို မေးပြီး အခြား account မငှားပါနှင့်။ |
| Offline/degraded | Button ထပ်မနှိပ်၊ LAN/Wi-Fi စစ်၊ Online ပြန်ဖြစ်မှ action သိမ်း/မသိမ်း စစ်ပါ။ |
| Table မမျှော်လင့်ဘဲ occupied | Existing order/bill ကို ဖွင့်စစ်ပါ။ Open session ဖုံးရန် table အတုအသစ် မလုပ်ပါနှင့်။ |
| Menu item မရှိ | Hidden/unavailable သို့မဟုတ် category မရှိနိုင်ပါ။ Menu manager ကို မေးပါ။ |
| Price/station မှား | မပို့ရသေးလျှင် ရပ်ပြီး menu admin ကို အကြောင်းကြားပါ။ ပြင်ဆင်မှုကို ticket တွင် စစ်ပါ။ |
| KDS ticket မပေါ် | Order save ဖြစ်/မဖြစ်၊ station၊ **Active orders**၊ Online နှင့် item routing ကို အစဉ်လိုက်စစ်ပါ။ |
| Payment button disabled | Cashier permission မရှိ၊ bill မပြင်ဆင်ရသေး၊ သို့မဟုတ် balance မရှိနိုင်ပါ။ |
| Close table disabled | Balance ကျန်နေ သို့မဟုတ် role ခွင့်မရှိပါ။ Payment ဖြေရှင်း/ cashier-manager ကို ခေါ်ပါ။ |
| Receipt မထွက် | ငွေထပ်မယူပါနှင့်။ Enabled/status/connection/paper စစ်ပြီး ပြင်ပြီးမှ တစ်ကြိမ်ပြန်ထုတ်ပါ။ |
| Transaction ထပ်နေသလိုမြင် | ရပ်ပါ။ Order ID၊ payment၊ Sales history၊ Audit ကို စစ်ပြီး မန်နေဂျာထံ တင်ပြပါ။ |
| Inventory balance မှား | ပစ္စည်းအမှန်ရေတွက်၊ movement/audit စစ်ပြီး ခွင့်ရှိမှ reason ပါသည့် correction တစ်ကြိမ်တင်ပါ။ |
| ပြင်ထားသည် ပျောက်/conflict | အခြား terminal က အရင်သိမ်းနိုင်ပါသည်။ Refresh၊ နောက်ဆုံး record စစ်ပြီး မပါသည့်အရာကိုသာ ပြန်ပြင်ပါ။ |

အကူအညီတောင်းရာတွင် ဖြစ်ချိန်၊ signed-in user၊ table၊ order/bill ID အတို၊ error စာသားနှင့် နှိပ်ခဲ့သည့် button ကို မှတ်ထားပါ။ Password ကို note သို့ screenshot တွင် မထည့်ပါနှင့်။

### ၁၅။ အမြန်စစ်ဆေးစာရင်း

**Waitstaff:** Online → မှန်ကန်သည့် table ရွေး/ဖွင့် → guests ထည့် → item ထည့်/စစ် → **Save order & print tickets** → **Waiter progress** စောင့်ကြည့် → မှန်ကန်သည့် table သို့ ပို့။

**Prep staff:** Station မှန် → **Active orders** → quantity/destination/note ဖတ် → **Start prep** → ပြင်ဆင် → **Mark ready**။

**Cashier:** Open check ရွေး → စစ် → split ရွေး/ခွဲ → bill ပြင် → balance စစ် → **Take cash payment** တစ်ကြိမ် → print/confirm → balance သုည → **Close paid table**။

**Manager:** Access/alert စစ် → ချွင်းချက်ကြီးကြပ် → sales/report/audit အတည်ပြု → open bill/ticket စစ် → အများသုံး device များ sign out ဖြစ်ကြောင်း စစ်။

---

## Document notes / စာတမ်းမှတ်ချက်

- This guide describes the browser controls present in the current SYM POS application. A deployment may rename prep stations, tables, restaurant identity, printers, and Myanmar labels.
- ဤလမ်းညွှန်သည် လက်ရှိ SYM POS application ရှိ browser control များကို ဖော်ပြထားပါသည်။ တပ်ဆင်ထားသည့်ဆိုင်အလိုက် prep station၊ table၊ restaurant identity၊ printer နှင့် Myanmar label အမည်များ ပြောင်းထားနိုင်ပါသည်။
- Managers should review this guide after workflow, permissions, pricing, tax, payment, or printer configuration changes.
- Workflow၊ permission၊ pricing၊ tax၊ payment သို့မဟုတ် printer configuration ပြောင်းတိုင်း မန်နေဂျာက ဤလမ်းညွှန်ကို ပြန်စစ်သင့်ပါသည်။
