export type SupportedLocale = 'en' | 'my';

export type LocalizableNamespace = 'paymentLabels' | 'billStatuses' | 'reportHeadings' | 'common' | 'screens';

export interface LocaleResource {
  locale: SupportedLocale;
  nativeName: string;
  direction: 'ltr';
  unicodeSample: string;
  fontStack: string;
  printFontStack: string;
  paymentLabels: Record<string, string>;
  billStatuses: Record<string, string>;
  reportHeadings: Record<string, string>;
  common: Record<string, string>;
  screens: Record<string, string>;
}

export const DEFAULT_LOCALE: SupportedLocale = 'en';
export const REQUIRED_LOCALE: SupportedLocale = 'my';
export const LOCALIZABLE_NAMESPACES: LocalizableNamespace[] = ['paymentLabels', 'billStatuses', 'reportHeadings', 'common', 'screens'];

export interface EnglishMyanmarTranslationEntry {
  namespace: LocalizableNamespace;
  key: string;
  english: string;
  myanmar: string;
}

const burmeseFontStack = "'Noto Sans Myanmar', 'Padauk', 'Myanmar Text', 'Pyidaungsu', sans-serif";

export const localeResources: Record<SupportedLocale, LocaleResource> = {
  en: {
    locale: 'en',
    nativeName: 'English',
    direction: 'ltr',
    unicodeSample: 'Unicode rendering check: paid bill, cash payment, sales report.',
    fontStack: "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    printFontStack: "Inter, Arial, sans-serif",
    paymentLabels: {
      cash: 'Cash',
      card: 'Card',
      wallet: 'Wallet',
      bank_transfer: 'Bank transfer',
      wave_money: 'Wave Money',
      kbzpay: 'KBZPay',
    },
    billStatuses: {
      open: 'Open',
      partially_paid: 'Partially paid',
      paid: 'Paid',
      debt: 'Debt',
      void: 'Void',
    },
    reportHeadings: {
      sales_by_day: 'Sales by day',
      sales_by_week: 'Sales by week',
      sales_by_month: 'Sales by month',
      inventory_usage_stock_trend: 'Inventory usage and stock trend',
      financial_summary: 'Financial summary',
      range: 'Range',
      period: 'Period',
      orders: 'Orders',
      quantity_sold: 'Quantity sold',
      revenue: 'Revenue',
      sku: 'SKU',
      item: 'Item',
      unit: 'Unit',
      opening_stock: 'Opening stock',
      restocked: 'Restocked',
      used: 'Used',
      wastage: 'Wastage',
      manual_adjustments: 'Manual adjustments',
      closing_stock: 'Closing stock',
      metric: 'Metric',
      amount: 'Amount',
    },
    common: {
      tax_enabled: 'Tax enabled',
      tax_exempt: 'Tax exempt',
      locale: 'Language',
      receipt: 'Receipt',
      table_session: 'Table session',
      total_paid: 'Total paid',
      balance_due: 'Balance due',
      split: 'Split',
      subtotal: 'Subtotal',
      discount: 'Discount',
      tax: 'Tax',
      total_due: 'Total due',
    },
    screens: {
      billing: 'Billing',
      orders: 'Orders',
      kitchen: 'Kitchen display',
      bar: 'Bar display',
      waiter_progress: 'Order progress',
      admin_menu: 'Menu management',
      inventory_alerts: 'Inventory alerts',
      audit_viewer: 'Admin Audit Viewer',
    },
  },
  my: {
    locale: 'my',
    nativeName: 'မြန်မာ',
    direction: 'ltr',
    unicodeSample: 'ယူနီကုဒ် စမ်းသပ်ချက် - ငွေပေးချေပြီး ဘောင်ချာ၊ ငွေသားပေးချေမှု၊ ရောင်းအား အစီရင်ခံစာ။',
    fontStack: burmeseFontStack,
    printFontStack: burmeseFontStack,
    paymentLabels: {
      cash: 'ငွေသား',
      card: 'ကတ်',
      wallet: 'မိုဘိုင်းပိုက်ဆံအိတ်',
      bank_transfer: 'ဘဏ်လွှဲငွေ',
      wave_money: 'Wave Money',
      kbzpay: 'KBZPay',
    },
    billStatuses: {
      open: 'ဖွင့်ထားသည်',
      partially_paid: 'တစ်စိတ်တစ်ပိုင်း ပေးချေပြီး',
      paid: 'ပေးချေပြီး',
      debt: 'အကြွေး',
      void: 'ပယ်ဖျက်ပြီး',
    },
    reportHeadings: {
      sales_by_day: 'နေ့အလိုက် ရောင်းအား',
      sales_by_week: 'အပတ်အလိုက် ရောင်းအား',
      sales_by_month: 'လအလိုက် ရောင်းအား',
      inventory_usage_stock_trend: 'ကုန်ပစ္စည်း အသုံးပြုမှုနှင့် လက်ကျန် ပြောင်းလဲမှု',
      financial_summary: 'ဘဏ္ဍာရေး အကျဉ်းချုပ်',
      range: 'ကာလအပိုင်းအခြား',
      period: 'ကာလ',
      orders: 'အော်ဒါများ',
      quantity_sold: 'ရောင်းချပြီး အရေအတွက်',
      revenue: 'ဝင်ငွေ',
      sku: 'SKU',
      item: 'ပစ္စည်း',
      unit: 'ယူနစ်',
      opening_stock: 'အစ လက်ကျန်',
      restocked: 'ပြန်ဖြည့်ထားသော',
      used: 'အသုံးပြုထားသော',
      wastage: 'ဆုံးရှုံးမှု',
      manual_adjustments: 'လက်ဖြင့် ပြင်ဆင်ချက်များ',
      closing_stock: 'အဆုံး လက်ကျန်',
      metric: 'တိုင်းတာချက်',
      amount: 'ပမာဏ',
    },
    common: {
      tax_enabled: 'အခွန် ဖွင့်ထားသည်',
      tax_exempt: 'အခွန် ကင်းလွတ်သည်',
      locale: 'ဘာသာစကား',
      receipt: 'ဘောင်ချာ',
      table_session: 'စားပွဲ အသုံးပြုချိန်',
      total_paid: 'စုစုပေါင်း ပေးချေပြီး',
      balance_due: 'ပေးရန် ကျန်ငွေ',
      split: 'ခွဲခြမ်း',
      subtotal: 'စုစုပေါင်းခွဲ',
      discount: 'လျှော့စျေး',
      tax: 'အခွန်',
      total_due: 'စုစုပေါင်း ပေးရန်',
    },
    screens: {
      billing: 'ငွေရှင်း',
      orders: 'အော်ဒါများ',
      kitchen: 'မီးဖိုချောင် မျက်နှာပြင်',
      bar: 'ဘား မျက်နှာပြင်',
      waiter_progress: 'အော်ဒါ တိုးတက်မှု',
      admin_menu: 'မီနူး စီမံခန့်ခွဲမှု',
      inventory_alerts: 'ကုန်ပစ္စည်း သတိပေးချက်များ',
      audit_viewer: 'စီမံခန့်ခွဲရေး မှတ်တမ်းကြည့်ရန်',
    },
  },
};


export function buildEnglishMyanmarLocalizationMap(): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const namespace of LOCALIZABLE_NAMESPACES) {
    for (const [key, english] of Object.entries(localeResources.en[namespace])) {
      mapping[english] = localeResources.my[namespace][key] ?? english;
    }
  }
  return mapping;
}

export function listEnglishMyanmarTranslationEntries(overrides: Record<string, string> = {}): EnglishMyanmarTranslationEntry[] {
  return LOCALIZABLE_NAMESPACES.flatMap((namespace) => Object.entries(localeResources.en[namespace]).map(([key, english]) => ({
    namespace,
    key,
    english,
    myanmar: overrides[english] ?? localeResources.my[namespace][key] ?? english,
  })));
}

export function applyEnglishMyanmarLocalizationMap(resource: LocaleResource, mapping: Record<string, string>): LocaleResource {
  if (resource.locale !== 'my') return structuredClone(resource);

  const localized = structuredClone(resource);
  for (const namespace of LOCALIZABLE_NAMESPACES) {
    for (const [key, english] of Object.entries(localeResources.en[namespace])) {
      const mapped = mapping[english]?.trim();
      if (mapped) localized[namespace][key] = mapped;
    }
  }
  return localized;
}
