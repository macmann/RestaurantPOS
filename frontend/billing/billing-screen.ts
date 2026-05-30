import { buildLocaleSwitchState, getLocaleResource } from '../i18n/locale-switcher';
import { apiClient } from '../api/client';
import type { BillPricingOptions, BillPromotion, SplitLabel, TableOrderItem } from '../../backend/billing/repository';

export interface BillingScreenViewModel {
  tableSessionId: string;
  taxToggle: {
    mode: BillPricingOptions['taxMode'];
    label: string;
    rate: number;
  };
  calculationBreakdown: Awaited<ReturnType<typeof apiClient.getBillBreakdown>>;
  receiptPreview: Awaited<ReturnType<typeof apiClient.getReceipt>>;
  localeSwitch: ReturnType<typeof buildLocaleSwitchState>;
  labels: { title: string; taxEnabled: string; taxExempt: string };
}

export async function openBillingScreen(tableSessionId: string, locale?: string): Promise<BillingScreenViewModel> {
  const resource = getLocaleResource(locale);
  const calculationBreakdown = await apiClient.getBillBreakdown(tableSessionId);
  const receiptPreview = await apiClient.getReceipt(tableSessionId, resource.locale);

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
  await apiClient.createBill({ tableSessionId: input.tableSessionId, itemsBySplit: input.itemsBySplit, pricing: input.pricing, locale: input.locale }, input.actorUserId);
  return openBillingScreen(input.tableSessionId, input.locale);
}

export async function toggleBillTax(input: {
  tableSessionId: string;
  taxMode: BillPricingOptions['taxMode'];
  taxRate?: number;
  actorUserId: string;
  locale?: string;
}): Promise<BillingScreenViewModel> {
  await apiClient.setBillTaxMode({ tableSessionId: input.tableSessionId, taxMode: input.taxMode, taxRate: input.taxRate }, input.actorUserId);
  return openBillingScreen(input.tableSessionId, input.locale);
}

export async function updateBillLevelPromotions(input: {
  tableSessionId: string;
  billPromotions: BillPromotion[];
  actorUserId: string;
  locale?: string;
}): Promise<BillingScreenViewModel> {
  await apiClient.applyBillPromotions({ tableSessionId: input.tableSessionId, billPromotions: input.billPromotions }, input.actorUserId);
  return openBillingScreen(input.tableSessionId, input.locale);
}
