import { DEFAULT_LOCALE, localeResources, type LocaleResource, type SupportedLocale } from '../../backend/i18n/resources';

let activeLocale: SupportedLocale = normalizeLocale();

export function normalizeLocale(locale?: string): SupportedLocale {
  return locale === 'my' || locale === 'en' ? locale : DEFAULT_LOCALE;
}

export function getLocaleResource(locale?: string): LocaleResource {
  return localeResources[normalizeLocale(locale)];
}

export function listLocaleOptions() {
  return Object.values(localeResources).map((resource) => ({
    locale: resource.locale,
    label: resource.nativeName,
    unicodeSample: resource.unicodeSample,
  }));
}

export function getTypographyForLocale(locale?: string) {
  const resource = getLocaleResource(locale);
  return {
    locale: resource.locale,
    fontFamily: resource.fontStack,
    printFontFamily: resource.printFontStack,
    direction: resource.direction,
  };
}

export function verifyUnicodeCompatibility(locale?: string) {
  const resource = getLocaleResource(locale);
  return {
    locale: resource.locale,
    sample: resource.unicodeSample,
    requiresUnicode: resource.locale === 'my',
    recommendedFonts: resource.fontStack.split(',').map((font) => font.trim().replace(/^['\"]|['\"]$/g, '')),
  };
}

export function setActiveLocale(locale: string): SupportedLocale {
  activeLocale = normalizeLocale(locale);
  return activeLocale;
}

export function getActiveLocale(): SupportedLocale {
  return activeLocale;
}

export function buildLocaleSwitchState(locale: string = activeLocale) {
  const normalized = normalizeLocale(locale);
  const resource = getLocaleResource(normalized);
  return {
    activeLocale: normalized,
    label: resource.common.locale,
    options: listLocaleOptions(),
    typography: getTypographyForLocale(normalized),
    unicodeCompatibility: verifyUnicodeCompatibility(normalized),
  };
}
