import { getLocaleResource, getTypographyForLocale, listLocaleOptions, normalizeLocale, verifyUnicodeCompatibility } from '../../backend/i18n/service';
import type { SupportedLocale } from '../../backend/i18n/resources';

let activeLocale: SupportedLocale = normalizeLocale();

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
