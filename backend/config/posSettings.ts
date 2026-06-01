import { getRuntimeSettings } from './branch';
import { DEFAULT_LOCALE, type SupportedLocale } from '../i18n/resources';
import { normalizeLocale } from '../i18n/service';

export interface RestaurantBillInfo {
  restaurantName: string;
  address: string;
  contact: string;
  taxId?: string;
  receiptFooter?: string;
}

export interface PrinterDeviceConfig {
  enabled: boolean;
  printerId: string;
  displayName: string;
}

export interface PrinterSettings {
  receipt: PrinterDeviceConfig;
  kitchen: PrinterDeviceConfig;
  bar: PrinterDeviceConfig;
}

export interface LocalizationSettings {
  defaultLocale: SupportedLocale;
}

export interface PosOperationalSettings {
  restaurantBillInfo: RestaurantBillInfo;
  printers: PrinterSettings;
  localization: LocalizationSettings;
}

function envValue(key: string): string | undefined {
  return process.env[key]?.trim() || undefined;
}

function defaultSettings(): PosOperationalSettings {
  const runtime = getRuntimeSettings();
  return {
    restaurantBillInfo: {
      restaurantName: envValue('POS_RESTAURANT_NAME') ?? runtime.branch.branchName,
      address: envValue('POS_RESTAURANT_ADDRESS') ?? runtime.branch.locationLabel ?? 'Configure restaurant address in Settings',
      contact: envValue('POS_RESTAURANT_CONTACT') ?? 'Configure contact in Settings',
      taxId: envValue('POS_RESTAURANT_TAX_ID'),
      receiptFooter: envValue('POS_RECEIPT_FOOTER') ?? 'Thank you. Please visit again.',
    },
    printers: {
      receipt: { enabled: envValue('POS_RECEIPT_PRINTER_ENABLED') !== 'false', printerId: envValue('POS_RECEIPT_PRINTER_ID') ?? 'receipt-counter', displayName: envValue('POS_RECEIPT_PRINTER_NAME') ?? 'Receipt printer' },
      kitchen: { enabled: envValue('POS_KITCHEN_PRINTER_ENABLED') !== 'false', printerId: envValue('POS_KITCHEN_PRINTER_ID') ?? 'kitchen-hotline', displayName: envValue('POS_KITCHEN_PRINTER_NAME') ?? 'Kitchen printer' },
      bar: { enabled: envValue('POS_BAR_PRINTER_ENABLED') !== 'false', printerId: envValue('POS_BAR_PRINTER_ID') ?? 'bar-service', displayName: envValue('POS_BAR_PRINTER_NAME') ?? 'Bar printer' },
    },
    localization: {
      defaultLocale: normalizeLocale(envValue('POS_DEFAULT_LOCALE') ?? envValue('DEFAULT_LOCALE') ?? DEFAULT_LOCALE),
    },
  };
}

let currentSettings: PosOperationalSettings = defaultSettings();

function cleanText(value: unknown, fallback: string): string {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function normalizeLocalization(input: Partial<LocalizationSettings> | undefined, fallback: LocalizationSettings): LocalizationSettings {
  return {
    defaultLocale: normalizeLocale(input?.defaultLocale ?? fallback.defaultLocale),
  };
}

function normalizePrinter(input: Partial<PrinterDeviceConfig> | undefined, fallback: PrinterDeviceConfig): PrinterDeviceConfig {
  return {
    enabled: typeof input?.enabled === 'boolean' ? input.enabled : fallback.enabled,
    printerId: cleanText(input?.printerId, fallback.printerId),
    displayName: cleanText(input?.displayName, fallback.displayName),
  };
}

export function getPosOperationalSettings(): PosOperationalSettings {
  return structuredClone(currentSettings);
}

export function updatePosOperationalSettings(input: Partial<PosOperationalSettings>): PosOperationalSettings {
  currentSettings = {
    restaurantBillInfo: {
      restaurantName: cleanText(input.restaurantBillInfo?.restaurantName, currentSettings.restaurantBillInfo.restaurantName),
      address: cleanText(input.restaurantBillInfo?.address, currentSettings.restaurantBillInfo.address),
      contact: cleanText(input.restaurantBillInfo?.contact, currentSettings.restaurantBillInfo.contact),
      taxId: String(input.restaurantBillInfo?.taxId ?? currentSettings.restaurantBillInfo.taxId ?? '').trim() || undefined,
      receiptFooter: String(input.restaurantBillInfo?.receiptFooter ?? currentSettings.restaurantBillInfo.receiptFooter ?? '').trim() || undefined,
    },
    printers: {
      receipt: normalizePrinter(input.printers?.receipt, currentSettings.printers.receipt),
      kitchen: normalizePrinter(input.printers?.kitchen, currentSettings.printers.kitchen),
      bar: normalizePrinter(input.printers?.bar, currentSettings.printers.bar),
    },
    localization: normalizeLocalization(input.localization, currentSettings.localization),
  };
  return getPosOperationalSettings();
}
