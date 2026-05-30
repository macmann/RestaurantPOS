import { DEFAULT_LOCALE, REQUIRED_LOCALE, localeResources, type LocaleResource, type SupportedLocale } from './resources';

export interface LocaleOption {
  locale: SupportedLocale;
  nativeName: string;
  required: boolean;
}

export interface UnicodeCompatibilityReport {
  locale: SupportedLocale;
  compatible: boolean;
  sample: string;
  fontStack: string;
  printFontStack: string;
  notes: string[];
}

export function normalizeLocale(locale?: string): SupportedLocale {
  const normalized = locale?.toLowerCase().replace('_', '-');
  return normalized === REQUIRED_LOCALE || normalized?.startsWith(`${REQUIRED_LOCALE}-`) ? REQUIRED_LOCALE : DEFAULT_LOCALE;
}

export function getLocaleResource(locale?: string): LocaleResource {
  return localeResources[normalizeLocale(locale)];
}

export function listLocaleOptions(): LocaleOption[] {
  return Object.values(localeResources).map((resource) => ({
    locale: resource.locale,
    nativeName: resource.nativeName,
    required: resource.locale === REQUIRED_LOCALE,
  }));
}

export function t(locale: string | undefined, namespace: keyof LocaleResource, key: string): string {
  const resource = getLocaleResource(locale);
  const group = resource[namespace];
  if (group && typeof group === 'object' && key in group) return (group as Record<string, string>)[key];
  const fallbackGroup = localeResources[DEFAULT_LOCALE][namespace];
  if (fallbackGroup && typeof fallbackGroup === 'object' && key in fallbackGroup) return (fallbackGroup as Record<string, string>)[key];
  return key;
}

export function getTypographyForLocale(locale?: string) {
  const resource = getLocaleResource(locale);
  return {
    direction: resource.direction,
    fontFamily: resource.fontStack,
    printFontFamily: resource.printFontStack,
    unicodeSample: resource.unicodeSample,
  };
}

export function verifyUnicodeCompatibility(locale?: string): UnicodeCompatibilityReport {
  const resource = getLocaleResource(locale);
  const hasMyanmarGlyphs = /[\u1000-\u109F\uAA60-\uAA7F]/u.test(resource.unicodeSample);
  const fontStackIncludesMyanmarFont = /Myanmar|Padauk|Pyidaungsu/u.test(resource.printFontStack);
  const compatible = resource.locale !== REQUIRED_LOCALE || (hasMyanmarGlyphs && fontStackIncludesMyanmarFont);

  return {
    locale: resource.locale,
    compatible,
    sample: resource.unicodeSample,
    fontStack: resource.fontStack,
    printFontStack: resource.printFontStack,
    notes: compatible
      ? ['Unicode strings are stored as UTF-8 source text.', 'Print output declares a Myanmar-capable fallback font stack.']
      : ['Burmese locale must include Myanmar Unicode text and a Myanmar-capable print font.'],
  };
}
