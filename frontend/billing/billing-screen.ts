import {
  applyBillPromotions,
  generateBillFromSessionItems,
  getBillCalculationBreakdown,
  getPrintedReceiptPayload,
  setBillTaxMode,
} from '../../backend/billing/service';
import type { BillPricingOptions, BillPromotion, SplitLabel, TableOrderItem } from '../../backend/billing/repository';

export interface BillingScreenViewModel {
  tableSessionId: string;
  taxToggle: {
    mode: BillPricingOptions['taxMode'];
    label: string;
    rate: number;
  };
  calculationBreakdown: Awaited<ReturnType<typeof getBillCalculationBreakdown>>;
  receiptPreview: Awaited<ReturnType<typeof getPrintedReceiptPayload>>;
}

export async function openBillingScreen(tableSessionId: string): Promise<BillingScreenViewModel> {
  const calculationBreakdown = await getBillCalculationBreakdown(tableSessionId);
  const receiptPreview = await getPrintedReceiptPayload(tableSessionId);

  return {
    tableSessionId,
    taxToggle: {
      mode: calculationBreakdown.taxMode,
      label: calculationBreakdown.taxMode === 'taxable' ? 'Tax enabled' : 'Tax exempt',
      rate: calculationBreakdown.taxRate,
    },
    calculationBreakdown,
    receiptPreview,
  };
}

export async function startBillForBillingScreen(input: {
  tableSessionId: string;
  itemsBySplit: Partial<Record<SplitLabel, TableOrderItem[]>>;
  actorUserId: string;
  pricing?: Partial<BillPricingOptions>;
}): Promise<BillingScreenViewModel> {
  await generateBillFromSessionItems(input.tableSessionId, input.itemsBySplit, input.actorUserId, input.pricing);
  return openBillingScreen(input.tableSessionId);
}

export async function toggleBillTax(input: {
  tableSessionId: string;
  taxMode: BillPricingOptions['taxMode'];
  taxRate?: number;
  actorUserId: string;
}): Promise<BillingScreenViewModel> {
  await setBillTaxMode(input);
  return openBillingScreen(input.tableSessionId);
}

export async function updateBillLevelPromotions(input: {
  tableSessionId: string;
  billPromotions: BillPromotion[];
  actorUserId: string;
}): Promise<BillingScreenViewModel> {
  await applyBillPromotions(input);
  return openBillingScreen(input.tableSessionId);
}
