import { getRuntimeSettings } from './branch';
import { buildEnglishMyanmarLocalizationMap, DEFAULT_LOCALE, type SupportedLocale } from '../i18n/resources';
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

export interface PrepStationConfig {
  id: string;
  displayName: string;
  enabled: boolean;
  sortOrder: number;
}

export type PrinterSettings = Record<string, PrinterDeviceConfig> & {
  receipt: PrinterDeviceConfig;
};

export interface LocalizationSettings {
  defaultLocale: SupportedLocale;
  englishToMyanmar: Record<string, string>;
}

export interface TaxSettings {
  enabled: boolean;
  rate: number;
}

export interface PosOperationalSettings {
  restaurantBillInfo: RestaurantBillInfo;
  tax: TaxSettings;
  prepStations: PrepStationConfig[];
  printers: PrinterSettings;
  localization: LocalizationSettings;
}

function envValue(key: string): string | undefined {
  return process.env[key]?.trim() || undefined;
}

function slugifyStationId(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function defaultStationPrinter(stationId: string, displayName: string): PrinterDeviceConfig {
  const envPrefix = stationId.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  return {
    enabled: envValue(`POS_${envPrefix}_PRINTER_ENABLED`) !== 'false',
    printerId: envValue(`POS_${envPrefix}_PRINTER_ID`) ?? `${stationId}-printer`,
    displayName: envValue(`POS_${envPrefix}_PRINTER_NAME`) ?? `${displayName} printer`,
  };
}

function defaultSettings(): PosOperationalSettings {
  const runtime = getRuntimeSettings();
  const prepStations: PrepStationConfig[] = [
    { id: 'kitchen', displayName: 'Kitchen', enabled: true, sortOrder: 10 },
    { id: 'bar', displayName: 'Bar', enabled: true, sortOrder: 20 },
  ];
  return {
    restaurantBillInfo: {
      restaurantName: envValue('POS_RESTAURANT_NAME') ?? runtime.branch.branchName,
      address: envValue('POS_RESTAURANT_ADDRESS') ?? runtime.branch.locationLabel ?? 'Configure restaurant address in Settings',
      contact: envValue('POS_RESTAURANT_CONTACT') ?? 'Configure contact in Settings',
      taxId: envValue('POS_RESTAURANT_TAX_ID'),
      receiptFooter: envValue('POS_RECEIPT_FOOTER') ?? 'Thank you. Please visit again.',
    },
    tax: {
      enabled: envValue('POS_TAX_ENABLED') === 'true',
      rate: Number(envValue('POS_TAX_RATE') ?? 0),
    },
    prepStations,
    printers: {
      receipt: { enabled: envValue('POS_RECEIPT_PRINTER_ENABLED') !== 'false', printerId: envValue('POS_RECEIPT_PRINTER_ID') ?? 'receipt-counter', displayName: envValue('POS_RECEIPT_PRINTER_NAME') ?? 'Receipt printer' },
      kitchen: { enabled: envValue('POS_KITCHEN_PRINTER_ENABLED') !== 'false', printerId: envValue('POS_KITCHEN_PRINTER_ID') ?? 'kitchen-hotline', displayName: envValue('POS_KITCHEN_PRINTER_NAME') ?? 'Kitchen printer' },
      bar: { enabled: envValue('POS_BAR_PRINTER_ENABLED') !== 'false', printerId: envValue('POS_BAR_PRINTER_ID') ?? 'bar-service', displayName: envValue('POS_BAR_PRINTER_NAME') ?? 'Bar printer' },
    },
    localization: {
      defaultLocale: normalizeLocale(envValue('POS_DEFAULT_LOCALE') ?? envValue('DEFAULT_LOCALE') ?? DEFAULT_LOCALE),
      englishToMyanmar: buildEnglishMyanmarLocalizationMap(),
    },
  };
}

let currentSettings: PosOperationalSettings = defaultSettings();

function cleanText(value: unknown, fallback: string): string {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function normalizeEnglishMyanmarMapping(input: unknown, fallback: Record<string, string>): Record<string, string> {
  if (!input || Array.isArray(input) || typeof input !== 'object') return { ...fallback };

  const cleaned: Record<string, string> = {};
  for (const [english, myanmar] of Object.entries(input as Record<string, unknown>)) {
    const normalizedEnglish = english.trim();
    if (!normalizedEnglish) continue;
    cleaned[normalizedEnglish] = String(myanmar ?? '').trim() || fallback[normalizedEnglish] || normalizedEnglish;
  }
  return { ...fallback, ...cleaned };
}

function normalizeLocalization(input: Partial<LocalizationSettings> | undefined, fallback: LocalizationSettings): LocalizationSettings {
  return {
    defaultLocale: normalizeLocale(input?.defaultLocale ?? fallback.defaultLocale),
    englishToMyanmar: normalizeEnglishMyanmarMapping(input?.englishToMyanmar, fallback.englishToMyanmar),
  };
}

function normalizeTax(input: Partial<TaxSettings> | undefined, fallback: TaxSettings): TaxSettings {
  const rate = Number(input?.rate ?? fallback.rate);
  if (!Number.isFinite(rate) || rate < 0) throw new Error('tax.rate must be a non-negative finite number.');
  return { enabled: typeof input?.enabled === 'boolean' ? input.enabled : fallback.enabled, rate: Math.round((rate + Number.EPSILON) * 100) / 100 };
}

function normalizePrinter(input: Partial<PrinterDeviceConfig> | undefined, fallback: PrinterDeviceConfig): PrinterDeviceConfig {
  return {
    enabled: typeof input?.enabled === 'boolean' ? input.enabled : fallback.enabled,
    printerId: cleanText(input?.printerId, fallback.printerId),
    displayName: cleanText(input?.displayName, fallback.displayName),
  };
}

function normalizePrepStations(input: unknown, fallback: PrepStationConfig[]): PrepStationConfig[] {
  const source = Array.isArray(input) ? input : fallback;
  const byId = new Map<string, PrepStationConfig>();
  source.forEach((station, index) => {
    const raw = station as Partial<PrepStationConfig> & { name?: string };
    const id = slugifyStationId(raw.id ?? raw.name ?? raw.displayName);
    if (!id || id === 'receipt') return;
    const existing = fallback.find((row) => row.id === id);
    const displayName = cleanText(raw.displayName ?? raw.name, existing?.displayName ?? id.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()));
    byId.set(id, {
      id,
      displayName,
      enabled: typeof raw.enabled === 'boolean' ? raw.enabled : existing?.enabled ?? true,
      sortOrder: Number.isFinite(raw.sortOrder) ? Number(raw.sortOrder) : existing?.sortOrder ?? (index + 1) * 10,
    });
  });
  if (!byId.size) fallback.forEach((station) => byId.set(station.id, station));
  return [...byId.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.displayName.localeCompare(b.displayName));
}

function normalizePrinters(input: Partial<PrinterSettings> | undefined, stations: PrepStationConfig[], fallback: PrinterSettings): PrinterSettings {
  const printers: PrinterSettings = {
    receipt: normalizePrinter(input?.receipt, fallback.receipt),
  };
  for (const station of stations) {
    const fallbackPrinter = fallback[station.id] ?? defaultStationPrinter(station.id, station.displayName);
    printers[station.id] = normalizePrinter(input?.[station.id], fallbackPrinter);
  }
  return printers;
}

export function getPosOperationalSettings(): PosOperationalSettings {
  return structuredClone(currentSettings);
}

export function listPrepStations(includeDisabled = false): PrepStationConfig[] {
  return getPosOperationalSettings().prepStations.filter((station) => includeDisabled || station.enabled);
}

export function isConfiguredPrepStation(station: string | undefined, includeDisabled = false): boolean {
  if (!station) return false;
  return listPrepStations(includeDisabled).some((row) => row.id === station);
}

export function normalizePrepStationId(value: unknown): string {
  const station = slugifyStationId(value);
  if (!station) throw new Error('prepStation is required.');
  return station;
}

type PosOperationalSettingsInput = Partial<Omit<PosOperationalSettings, 'localization'>> & {
  localization?: Partial<LocalizationSettings>;
};

export function updatePosOperationalSettings(input: PosOperationalSettingsInput): PosOperationalSettings {
  const prepStations = normalizePrepStations(input.prepStations, currentSettings.prepStations);
  currentSettings = {
    restaurantBillInfo: {
      restaurantName: cleanText(input.restaurantBillInfo?.restaurantName, currentSettings.restaurantBillInfo.restaurantName),
      address: cleanText(input.restaurantBillInfo?.address, currentSettings.restaurantBillInfo.address),
      contact: cleanText(input.restaurantBillInfo?.contact, currentSettings.restaurantBillInfo.contact),
      taxId: String(input.restaurantBillInfo?.taxId ?? currentSettings.restaurantBillInfo.taxId ?? '').trim() || undefined,
      receiptFooter: String(input.restaurantBillInfo?.receiptFooter ?? currentSettings.restaurantBillInfo.receiptFooter ?? '').trim() || undefined,
    },
    tax: normalizeTax(input.tax, currentSettings.tax),
    prepStations,
    printers: normalizePrinters(input.printers, prepStations, currentSettings.printers),
    localization: normalizeLocalization(input.localization, currentSettings.localization),
  };
  return getPosOperationalSettings();
}
