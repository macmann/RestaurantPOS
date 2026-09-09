import { getRuntimeSettings } from './branch';
import { buildEnglishMyanmarLocalizationMap, DEFAULT_LOCALE, type SupportedLocale } from '../i18n/resources';
import { normalizeLocale } from '../i18n/service';
import { isSqlRepositoryEnabled } from '../db/client';
import { getRecord, putRecord } from '../db/repositoryStore';

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
  connectionType: 'simulator' | 'network';
  networkAddress?: string;
  networkPort: number;
  copies: number;
  autoPrint: boolean;
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
  menuInventoryLinkEnabled: boolean;
  restaurantBillInfo: RestaurantBillInfo;
  tax: TaxSettings;
  prepStations: PrepStationConfig[];
  printers: PrinterSettings;
  /** Maps each print operation (`receipt` or a prep-station id) to a configured printer. */
  printerAssignments: Record<string, string>;
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
    connectionType: envValue(`POS_${envPrefix}_PRINTER_TYPE`) === 'network' ? 'network' : 'simulator',
    networkAddress: envValue(`POS_${envPrefix}_PRINTER_ADDRESS`),
    networkPort: Number(envValue(`POS_${envPrefix}_PRINTER_PORT`) ?? 9100),
    copies: Number(envValue(`POS_${envPrefix}_PRINTER_COPIES`) ?? 1),
    autoPrint: envValue(`POS_${envPrefix}_PRINTER_AUTO_PRINT`) !== 'false',
  };
}

function defaultSettings(): PosOperationalSettings {
  const runtime = getRuntimeSettings();
  const prepStations: PrepStationConfig[] = [
    { id: 'kitchen', displayName: 'Kitchen', enabled: true, sortOrder: 10 },
    { id: 'bar', displayName: 'Bar', enabled: true, sortOrder: 20 },
  ];
  return {
    menuInventoryLinkEnabled: envValue('POS_MENU_INVENTORY_LINK_ENABLED') === 'true',
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
      receipt: { enabled: envValue('POS_RECEIPT_PRINTER_ENABLED') !== 'false', printerId: envValue('POS_RECEIPT_PRINTER_ID') ?? 'receipt-counter', displayName: envValue('POS_RECEIPT_PRINTER_NAME') ?? 'Receipt printer', connectionType: 'simulator', networkPort: 9100, copies: 1, autoPrint: false },
      kitchen: defaultStationPrinter('kitchen', 'Kitchen'),
      bar: defaultStationPrinter('bar', 'Bar'),
    },
    printerAssignments: { receipt: 'receipt', kitchen: 'kitchen', bar: 'bar' },
    localization: {
      defaultLocale: normalizeLocale(envValue('POS_DEFAULT_LOCALE') ?? envValue('DEFAULT_LOCALE') ?? DEFAULT_LOCALE),
      englishToMyanmar: buildEnglishMyanmarLocalizationMap(),
    },
  };
}

let currentSettings: PosOperationalSettings = defaultSettings();
let initialization: Promise<void> | null = null;

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
  const networkPort = Number(input?.networkPort ?? fallback.networkPort ?? 9100);
  const copies = Number(input?.copies ?? fallback.copies ?? 1);
  return {
    enabled: typeof input?.enabled === 'boolean' ? input.enabled : fallback.enabled,
    printerId: cleanText(input?.printerId, fallback.printerId),
    displayName: cleanText(input?.displayName, fallback.displayName),
    connectionType: input?.connectionType === 'network' ? 'network' : (fallback.connectionType ?? 'simulator'),
    networkAddress: String(input?.networkAddress ?? fallback.networkAddress ?? '').trim() || undefined,
    networkPort: Number.isInteger(networkPort) && networkPort > 0 && networkPort <= 65535 ? networkPort : 9100,
    copies: Number.isInteger(copies) && copies >= 1 && copies <= 10 ? copies : 1,
    autoPrint: typeof input?.autoPrint === 'boolean' ? input.autoPrint : (fallback.autoPrint ?? false),
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

function normalizePrinters(input: Partial<Record<string, Partial<PrinterDeviceConfig>>> | undefined, stations: PrepStationConfig[], fallback: PrinterSettings): PrinterSettings {
  const source = input ?? {};
  const printers = {} as PrinterSettings;
  const keys = new Set([...Object.keys(fallback), ...Object.keys(source)]);
  keys.add('receipt');
  for (const key of keys) {
    const station = stations.find((row) => row.id === key);
    const fallbackPrinter = fallback[key] ?? (key === 'receipt'
      ? defaultSettings().printers.receipt
      : defaultStationPrinter(key, station?.displayName ?? key));
    printers[key] = normalizePrinter(source[key], fallbackPrinter);
  }
  return printers;
}

function normalizePrinterAssignments(
  input: Record<string, unknown> | undefined,
  stations: PrepStationConfig[],
  printers: PrinterSettings,
  fallback: Record<string, string>,
): Record<string, string> {
  const assignments: Record<string, string> = {};
  for (const operation of ['receipt', ...stations.map((station) => station.id)]) {
    const requested = String(input?.[operation] ?? fallback[operation] ?? operation).trim();
    assignments[operation] = printers[requested] ? requested : (printers[operation] ? operation : 'receipt');
  }
  return assignments;
}

export function getPosOperationalSettings(): PosOperationalSettings {
  return structuredClone(currentSettings);
}

export function isMenuInventoryLinkEnabled(): boolean {
  return currentSettings.menuInventoryLinkEnabled;
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

type PosOperationalSettingsInput = Partial<Omit<PosOperationalSettings, 'localization' | 'printers'>> & {
  localization?: Partial<LocalizationSettings>;
  printers?: Partial<Record<string, Partial<PrinterDeviceConfig>>>;
  printerAssignments?: Record<string, unknown>;
};

export function updatePosOperationalSettings(input: PosOperationalSettingsInput): PosOperationalSettings {
  const prepStations = normalizePrepStations(input.prepStations, currentSettings.prepStations);
  const printers = normalizePrinters(input.printers, prepStations, currentSettings.printers);
  currentSettings = {
    menuInventoryLinkEnabled: typeof input.menuInventoryLinkEnabled === 'boolean'
      ? input.menuInventoryLinkEnabled
      : currentSettings.menuInventoryLinkEnabled,
    restaurantBillInfo: {
      restaurantName: cleanText(input.restaurantBillInfo?.restaurantName, currentSettings.restaurantBillInfo.restaurantName),
      address: cleanText(input.restaurantBillInfo?.address, currentSettings.restaurantBillInfo.address),
      contact: cleanText(input.restaurantBillInfo?.contact, currentSettings.restaurantBillInfo.contact),
      taxId: String(input.restaurantBillInfo?.taxId ?? currentSettings.restaurantBillInfo.taxId ?? '').trim() || undefined,
      receiptFooter: String(input.restaurantBillInfo?.receiptFooter ?? currentSettings.restaurantBillInfo.receiptFooter ?? '').trim() || undefined,
    },
    tax: normalizeTax(input.tax, currentSettings.tax),
    prepStations,
    printers,
    printerAssignments: normalizePrinterAssignments(input.printerAssignments, prepStations, printers, currentSettings.printerAssignments),
    localization: normalizeLocalization(input.localization, currentSettings.localization),
  };
  return getPosOperationalSettings();
}

/** Load the branch's operational settings before serving requests. */
export function initializePosOperationalSettings(forceReload = false): Promise<void> {
  if (!isSqlRepositoryEnabled()) return Promise.resolve();
  if (initialization && !forceReload) return initialization;

  initialization = (async () => {
    const saved = await getRecord<PosOperationalSettings>('settings:pos', getRuntimeSettings().branch.branchId);
    if (saved) updatePosOperationalSettings(saved);
  })();
  return initialization;
}

/** Update settings and durably save them for this branch when PostgreSQL is enabled. */
export async function savePosOperationalSettings(input: PosOperationalSettingsInput): Promise<PosOperationalSettings> {
  const previous = getPosOperationalSettings();
  const updated = updatePosOperationalSettings(input);
  if (!isSqlRepositoryEnabled()) return updated;

  try {
    await putRecord('settings:pos', getRuntimeSettings().branch.branchId, updated);
    return updated;
  } catch (error) {
    currentSettings = previous;
    throw error;
  }
}
