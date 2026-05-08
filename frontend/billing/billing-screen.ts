import {
  applyBillPromotions,
  generateBillFromSessionItems,
  getBillCalculationBreakdown,
  getPrintedReceiptPayload,
  setBillTaxMode,
} from '../../backend/billing/service';
import { getLocaleResource } from '../../backend/i18n/service';
import { buildLocaleSwitchState } from '../i18n/locale-switcher';
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
  localeSwitch: ReturnType<typeof buildLocaleSwitchState>;
  labels: { title: string; taxEnabled: string; taxExempt: string };
}

export async function openBillingScreen(tableSessionId: string, locale?: string): Promise<BillingScreenViewModel> {
  const resource = getLocaleResource(locale);
  const calculationBreakdown = await getBillCalculationBreakdown(tableSessionId);
  const receiptPreview = await getPrintedReceiptPayload(tableSessionId, resource.locale);

  return {
    tableSessionId,
    taxToggle: {
      mode: calculationBreakdown.taxMode,
      label: calculationBreakdown.taxMode === 'taxable' ? resource.common.tax_enabled : resource.common.tax_exempt,
      rate: calculationBreakdown.taxRate,
    },
    calculationBreakdown,
    receiptPreview,
    localeSwitch: buildLocaleSwitchState(resource.locale),
    labels: { title: resource.screens.billing, taxEnabled: resource.common.tax_enabled, taxExempt: resource.common.tax_exempt },
  };
}

export async function startBillForBillingScreen(input: {
  tableSessionId: string;
  itemsBySplit: Partial<Record<SplitLabel, TableOrderItem[]>>;
  actorUserId: string;
  pricing?: Partial<BillPricingOptions>;
  locale?: string;
}): Promise<BillingScreenViewModel> {
  await generateBillFromSessionItems(input.tableSessionId, input.itemsBySplit, input.actorUserId, input.pricing);
  return openBillingScreen(input.tableSessionId, input.locale);
}

export async function toggleBillTax(input: {
  tableSessionId: string;
  taxMode: BillPricingOptions['taxMode'];
  taxRate?: number;
  actorUserId: string;
  locale?: string;
}): Promise<BillingScreenViewModel> {
  await setBillTaxMode(input);
  return openBillingScreen(input.tableSessionId, input.locale);
}

export async function updateBillLevelPromotions(input: {
  tableSessionId: string;
  billPromotions: BillPromotion[];
  actorUserId: string;
  locale?: string;
}): Promise<BillingScreenViewModel> {
  await applyBillPromotions(input);
  return openBillingScreen(input.tableSessionId, input.locale);
}
