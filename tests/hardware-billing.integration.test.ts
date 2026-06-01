declare const process: { exitCode?: number };

import { listBillingAuditByTableSessionId, type TableOrderItem } from '../backend/billing/repository';
import { generateBillFromSessionItems, printBillReceipt, recordSplitPayment, refundSplitPayment, voidSplitPayment } from '../backend/billing/service';
import { resetCashDrawerAdapter } from '../backend/hardware/cashDrawer';
import { resetReceiptPrinterAdapter } from '../backend/hardware/receiptPrinter';
import { resetPaymentTerminalAdapter } from '../backend/integrations/paymentTerminal';
import { updatePosOperationalSettings } from '../backend/config/posSettings';
import { createTable, openTableSession } from '../backend/tables/service';
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
  const terminal = resetPaymentTerminalAdapter();
  const drawer = resetCashDrawerAdapter();
  const printer = resetReceiptPrinterAdapter();

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
  assertEqual(printer.jobs.length, 1, 'Simulator printer should capture the receipt job.');

  updatePosOperationalSettings({ localization: { defaultLocale: 'my' } });
  const defaultLocaleFixture = await createBillFixture('default-locale', 15);
  const defaultLocalePrint = await printBillReceipt({ tableSessionId: defaultLocaleFixture.session.id, actorUserId: defaultLocaleFixture.cashier.id });
  assertEqual(defaultLocalePrint.locale, 'my', 'Receipt printing should use the configured Myanmar default locale when no locale override is supplied.');
  assert(defaultLocalePrint.renderedText.includes('ဘောင်ချာ'), 'Default-locale receipt should render Myanmar labels.');
  updatePosOperationalSettings({ localization: { defaultLocale: 'en' } });

  const cashFixture = await createBillFixture('cash', 25);
  await recordSplitPayment({ tableSessionId: cashFixture.session.id, splitLabel: 'A', amount: 25, method: 'cash', actorUserId: cashFixture.cashier.id });
  assertEqual(drawer.openEvents.length, 1, 'Cash payments should open the cash drawer exactly once.');
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
