declare const process: { exitCode?: number };

import { listBillingAuditByTableSessionId, type TableOrderItem } from '../backend/billing/repository';
import { generateBillFromSessionItems, printBillReceipt, recordSplitPayment, refundSplitPayment, voidSplitPayment } from '../backend/billing/service';
import { resetCashDrawerAdapter } from '../backend/hardware/cashDrawer';
import { renderReceiptPayload, resetReceiptPrinterAdapter } from '../backend/hardware/receiptPrinter';
import { resetOrderPrinterAdapter } from '../backend/hardware/orderPrinter';
import { buildNetworkPrinterTicket, containsMyanmarText, MYANMAR_PRINT_FONT_FAMILY, NETWORK_RASTER_FONT_HEIGHT_DOTS, printFontFamilyForText } from '../backend/hardware/printerTransport';
import type { OrderRecord } from '../backend/orders/repository';
import { resetPaymentTerminalAdapter } from '../backend/integrations/paymentTerminal';
import { updatePosOperationalSettings } from '../backend/config/posSettings';
import { closeTableSession, createTable, openTableSession } from '../backend/tables/service';
import type { AuthenticatedUser } from '../backend/auth/policies';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) throw new Error(`${message}. Expected ${String(expected)}, received ${String(actual)}.`);
}

async function createBillFixture(suffix: string, amount = 100) {
  const branchId = `branch-hw-${suffix}`;
  const cashier: AuthenticatedUser = { id: `cashier-hw-${suffix}`, branchId, role: 'cashier', status: 'active' };
  const table = await createTable({ branchId, name: `HW ${suffix}`, capacity: 2 });
  const session = await openTableSession(cashier, { branchId, tableId: table.id, guestCount: 1 });
  const item: TableOrderItem = {
    id: `item-hw-${suffix}`,
    orderId: `order-hw-${suffix}`,
    tableSessionId: session.id,
    name: 'Mohinga',
    quantity: 1,
    unitPrice: amount,
  };
  const bill = await generateBillFromSessionItems(session.id, { A: [item] }, cashier.id, { taxMode: 'tax_exempt' }, branchId);
  return { bill, cashier, session };
}

async function runHardwareBillingIntegration(): Promise<void> {
  const networkTicket = buildNetworkPrinterTicket('LAST RECEIPT LINE');
  const expectedCutSequence = Buffer.from('LAST RECEIPT LINE\n\n\n\n\n\x1dV\x00', 'utf8');
  assert(networkTicket.subarray(2).equals(expectedCutSequence), 'Network print jobs should feed five lines after the content before cutting.');
  assert(containsMyanmarText('ရွှေယမင်း စားသောက်ဆိုင်'), 'Myanmar receipt text should be detected so it is rasterized instead of sent through an unsupported ESC/POS code page.');
  assert(!containsMyanmarText('Shwe Ya Min Restaurant'), 'ASCII receipts should continue to use the compact native ESC/POS text path.');
  assertEqual(printFontFamilyForText('1 x မုန့်ဟင်းခါး', 'Arial'), MYANMAR_PRINT_FONT_FAMILY, 'Every print job containing Myanmar text should use a Myanmar-capable font, regardless of the UI locale.');
  assertEqual(printFontFamilyForText('1 x Mohinga', 'Arial'), 'Arial', 'Print jobs without Myanmar text should retain their requested font.');
  assertEqual(NETWORK_RASTER_FONT_HEIGHT_DOTS, 25, 'Rasterized Unicode receipts should render nine-point text at the physical 203-DPI print-head size rather than the 96-DPI bitmap default.');

  const terminal = resetPaymentTerminalAdapter();
  const drawer = resetCashDrawerAdapter();
  const printer = resetReceiptPrinterAdapter();
  const orderPrinter = resetOrderPrinterAdapter();

  updatePosOperationalSettings({
    printers: { bbq: { enabled: true, printerId: 'bbq-printer', displayName: 'BBQ printer', connectionType: 'simulator', networkPort: 9100, copies: 2, autoPrint: true } },
    printerAssignments: { kitchen: 'bbq' },
  });
  const windowsSettings = updatePosOperationalSettings({
    printers: { receipt: { connectionType: 'windows', windowsPrinterName: 'USB Receipt Printer' } },
  });
  assertEqual(windowsSettings.printers.receipt.connectionType, 'windows', 'Settings should accept a Windows installed printer connection.');
  assertEqual(windowsSettings.printers.receipt.windowsPrinterName, 'USB Receipt Printer', 'Settings should retain the exact Windows printer queue name.');
  const simulatorSettings = updatePosOperationalSettings({ printers: { receipt: { connectionType: 'simulator' } } });
  assertEqual(simulatorSettings.printers.receipt.connectionType, 'simulator', 'Settings should allow a physical printer to be changed back to simulator mode.');
  const ticketOrder: OrderRecord = {
    id: 'ord-hardware-ticket', branchId: 'branch-hw', serviceMode: 'dine_in', tableId: 'table-7', tableName: 'Table 7', tableSessionId: 'session-7',
    status: 'pending', subtotal: 12, version: 1, createdBy: 'waiter-1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), changeLog: [],
    items: [{ id: 'line-1', menuItemId: 'menu-1', name: 'မုန့်ဟင်းခါး', quantity: 1, unitPrice: 12, lineTotal: 12, station: 'kitchen', note: 'အကြော်ထည့်ပါ' }],
  };
  const tickets = await orderPrinter.printOrderForConfiguredStations(ticketOrder, true);
  assertEqual(tickets.length, 1, 'Automatic order printing should route items only to their configured station');
  assertEqual(tickets[0].copyCount, 2, 'Station copy configuration should be honored');
  assertEqual(tickets[0].printerId, 'bbq-printer', 'Kitchen printing should use the device assigned to that operation.');
  assert(tickets[0].renderedText.includes('Station: Kitchen'), 'Order ticket should identify the prep station.');
  assert(tickets[0].renderedText.includes('*** TABLE: Table 7 ***'), 'Order ticket should prominently identify the table to serve.');
  assert(tickets[0].renderedText.includes('Date & time:'), 'Order ticket should include its print date and time.');
  assert(tickets[0].renderedText.includes('မုန့်ဟင်းခါး') && tickets[0].renderedText.includes('အကြော်ထည့်ပါ'), 'Kitchen and bar tickets should preserve Myanmar item names and notes.');
  assert(!tickets[0].renderedText.includes(ticketOrder.id), 'Order ticket should not expose an internal order number.');
  assert(!tickets[0].renderedText.includes(ticketOrder.tableSessionId!), 'Order ticket should not expose an internal table session ID.');

  const cardFixture = await createBillFixture('card', 100);
  const paidByCard = await recordSplitPayment({ tableSessionId: cardFixture.session.id, splitLabel: 'A', amount: 100, method: 'card', actorUserId: cardFixture.cashier.id });
  const captured = paidByCard.splits.A.payments.find((payment) => payment.method === 'card' && payment.type === 'payment');
  assert(captured?.externalReference?.authorizationId, 'Card payment should retain an authorization reference.');
  assert(captured.externalReference.captureId, 'Card payment should retain a capture reference.');
  assertEqual(terminal.events.map((event) => event.type).join(','), 'authorize,capture', 'Card flow should authorize and capture through the terminal adapter');

  const refunded = await refundSplitPayment({ tableSessionId: cardFixture.session.id, splitLabel: 'A', paymentId: captured.id, amount: 40, actorUserId: cardFixture.cashier.id, reason: 'guest returned item' });
  const refund = refunded.splits.A.payments.find((payment) => payment.type === 'refund');
  assert(refund?.externalReference?.refundId, 'Refund should synchronize an external refund reference.');
  assertEqual(refunded.splits.A.amountPaid, 60, 'Refund should reduce synchronized bill amount paid.');
  assert(terminal.events.some((event) => event.type === 'refund'), 'Terminal adapter should receive the refund request.');

  const printed = await printBillReceipt({ tableSessionId: cardFixture.session.id, actorUserId: cardFixture.cashier.id, locale: 'my-MM', copies: 2 });
  assertEqual(printed.locale, 'my', 'Receipt printing should normalize my-MM to the Myanmar locale.');
  assert(printed.fontFamily.includes('Myanmar') || printed.fontFamily.includes('Padauk') || printed.fontFamily.includes('Pyidaungsu'), 'Myanmar receipt should select a Myanmar-capable print font.');
  assert(printed.renderedText.includes('ဘောင်ချာ'), 'Rendered receipt should include localized Myanmar labels.');
  assert(printed.renderedText.includes('Date & time:'), 'Customer receipt should include its generation date and time.');
  assert(printed.renderedText.includes(`*** TABLE: HW card ***`), 'Customer receipt should prominently identify the table.');
  assert(!printed.renderedText.includes(cardFixture.session.id), 'Customer receipts must not expose the internal table session ID.');
  assert(!printed.renderedText.includes('Locale:'), 'Customer receipts must not expose locale metadata.');
  assert(!printed.renderedText.includes('Font:'), 'Customer receipts must not expose font metadata.');
  assert(!printed.renderedText.includes('receipt_'), 'Customer receipts must not expose the internal receipt ID.');
  assert(!printed.renderedText.includes('Split A'), 'An unsplit customer receipt must not display a split label.');
  assertEqual(printer.jobs.length, 1, 'Simulator printer should capture the receipt job.');

  const splitFixture = await createBillFixture('split', 12);
  const splitItem: TableOrderItem = { id: 'item-hw-split-b', orderId: 'order-hw-split-b', tableSessionId: splitFixture.session.id, name: 'Tea', quantity: 1, unitPrice: 8 };
  const splitPayload = await import('../backend/billing/service').then(({ updateBillSplitItems, getPrintedReceiptPayload }) =>
    updateBillSplitItems({ tableSessionId: splitFixture.session.id, actorUserId: splitFixture.cashier.id, itemsBySplit: { A: [{ id: 'item-hw-split', orderId: 'order-hw-split', tableSessionId: splitFixture.session.id, name: 'Mohinga', quantity: 1, unitPrice: 12 }], B: [splitItem] } }).then(() => getPrintedReceiptPayload(splitFixture.session.id)));
  assert(renderReceiptPayload(splitPayload, 'A').includes('Mohinga'), 'Split A receipt should contain its assigned items.');
  assert(!renderReceiptPayload(splitPayload, 'A').includes('Tea'), 'Split A receipt must not contain another guest\'s items.');
  let combinedSplitRejected = false;
  try { renderReceiptPayload(splitPayload); } catch { combinedSplitRejected = true; }
  assert(combinedSplitRejected, 'A split bill must require selecting the guest split before printing.');

  const threeWayFixture = await createBillFixture('three-way-split', 10);
  const splitItemFor = (label: string, amount: number): TableOrderItem => ({
    id: `item-hw-three-${label.toLowerCase()}`,
    orderId: `order-hw-three-${label.toLowerCase()}`,
    tableSessionId: threeWayFixture.session.id,
    name: `Guest ${label} meal`,
    quantity: 1,
    unitPrice: amount,
  });
  const { updateBillSplitItems, getPrintedReceiptPayload } = await import('../backend/billing/service');
  await updateBillSplitItems({
    tableSessionId: threeWayFixture.session.id,
    actorUserId: threeWayFixture.cashier.id,
    itemsBySplit: { A: [splitItemFor('A', 10)], B: [splitItemFor('B', 20)], C: [splitItemFor('C', 30)] },
  });
  const printJobStart = printer.jobs.length;
  for (const label of ['A', 'B', 'C'] as const) {
    const result = await printBillReceipt({ tableSessionId: threeWayFixture.session.id, actorUserId: threeWayFixture.cashier.id, splitLabel: label });
    assert(result.renderedText.includes(`Guest ${label} meal`), `Split ${label} receipt should contain that guest's items.`);
    for (const other of ['A', 'B', 'C'].filter((candidate) => candidate !== label)) {
      assert(!result.renderedText.includes(`Guest ${other} meal`), `Split ${label} receipt must exclude Guest ${other}'s items.`);
    }
  }
  assertEqual(printer.jobs.length - printJobStart, 3, 'A three-person split should create three individual receipt print jobs.');

  await recordSplitPayment({ tableSessionId: threeWayFixture.session.id, splitLabel: 'A', amount: 100, method: 'cash', actorUserId: threeWayFixture.cashier.id });
  const partlyPaidReceipt = await getPrintedReceiptPayload(threeWayFixture.session.id);
  assertEqual(partlyPaidReceipt.balanceDue, 50, 'Overpaying one guest split must not offset the other guests balances.');
  let earlyCloseRejected = false;
  try { await closeTableSession(threeWayFixture.cashier, threeWayFixture.session.id); } catch { earlyCloseRejected = true; }
  assert(earlyCloseRejected, 'A table must remain open until every active split is paid.');
  await recordSplitPayment({ tableSessionId: threeWayFixture.session.id, splitLabel: 'B', amount: 20, method: 'cash', actorUserId: threeWayFixture.cashier.id });
  await recordSplitPayment({ tableSessionId: threeWayFixture.session.id, splitLabel: 'C', amount: 30, method: 'cash', actorUserId: threeWayFixture.cashier.id });
  const closedThreeWaySession = await closeTableSession(threeWayFixture.cashier, threeWayFixture.session.id);
  assertEqual(closedThreeWaySession.status, 'closed', 'The table should close after all three individual splits are paid.');

  updatePosOperationalSettings({ localization: { defaultLocale: 'my' } });
  const defaultLocaleFixture = await createBillFixture('default-locale', 15);
  const defaultLocalePrint = await printBillReceipt({ tableSessionId: defaultLocaleFixture.session.id, actorUserId: defaultLocaleFixture.cashier.id });
  assertEqual(defaultLocalePrint.locale, 'my', 'Receipt printing should use the configured Myanmar default locale when no locale override is supplied.');
  assert(defaultLocalePrint.renderedText.includes('ဘောင်ချာ'), 'Default-locale receipt should render Myanmar labels.');

  updatePosOperationalSettings({ localization: { defaultLocale: 'my', englishToMyanmar: { Receipt: 'စိတ်ကြိုက်ဘောင်ချာ' } } });
  const customLocaleFixture = await createBillFixture('custom-locale', 18);
  const customLocalePrint = await printBillReceipt({ tableSessionId: customLocaleFixture.session.id, actorUserId: customLocaleFixture.cashier.id });
  assert(customLocalePrint.renderedText.includes('စိတ်ကြိုက်ဘောင်ချာ'), 'Editable English-to-Burmese mapping should override Myanmar receipt labels.');

  updatePosOperationalSettings({ localization: { defaultLocale: 'en' } });

  const cashDrawerOpensBefore = drawer.openEvents.length;
  const cashFixture = await createBillFixture('cash', 25);
  await recordSplitPayment({ tableSessionId: cashFixture.session.id, splitLabel: 'A', amount: 25, method: 'cash', actorUserId: cashFixture.cashier.id });
  assertEqual(drawer.openEvents.length, cashDrawerOpensBefore + 1, 'Each cash payment should open the cash drawer exactly once.');
  const cashAudit = await listBillingAuditByTableSessionId(cashFixture.session.id);
  assert(cashAudit.some((event) => event.action === 'cash_drawer_opened'), 'Cash drawer openings should be written to billing audit.');

  const voidFixture = await createBillFixture('void', 30);
  const paidForVoid = await recordSplitPayment({ tableSessionId: voidFixture.session.id, splitLabel: 'A', amount: 30, method: 'bank_transfer', actorUserId: voidFixture.cashier.id });
  const original = paidForVoid.splits.A.payments.find((payment) => payment.method === 'bank_transfer' && payment.type === 'payment');
  assert(original, 'Bank transfer payment should be present before voiding.');
  const voided = await voidSplitPayment({ tableSessionId: voidFixture.session.id, splitLabel: 'A', paymentId: original.id, actorUserId: voidFixture.cashier.id, reason: 'operator mistake' });
  assertEqual(voided.splits.A.amountPaid, 0, 'Voided external payments should reverse local bill settlement state.');
  assert(voided.splits.A.payments.some((payment) => payment.type === 'void' && payment.externalReference?.voidId), 'Void entry should retain external void reference.');
}

runHardwareBillingIntegration().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
