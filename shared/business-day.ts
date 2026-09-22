export interface BusinessDayConfiguration {
  timezone: string;
  businessDayCutoff: string;
}

interface LocalParts { year: number; month: number; day: number; hour: number; minute: number; second: number }

function localParts(at: Date, timezone: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour'), minute: value('minute'), second: value('second') };
}

/** Convert a branch-local wall time to an instant, including across DST offset changes. */
function localWallTimeToInstant(parts: Omit<LocalParts, 'second'> & { timezone: string }): Date {
  const desired = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  let candidate = new Date(desired);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const observed = localParts(candidate, parts.timezone);
    const observedAsUtc = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute, observed.second);
    candidate = new Date(candidate.getTime() + desired - observedAsUtc);
  }
  return candidate;
}

function shiftCalendarDate(parts: Pick<LocalParts, 'year' | 'month' | 'day'>, days: number) {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

export function getBusinessDayRange(now: Date, configuration: BusinessDayConfiguration): { dateFrom: string; dateTo: string; businessDate: string } {
  const current = localParts(now, configuration.timezone);
  const [hour, minute] = configuration.businessDayCutoff.split(':').map(Number);
  const beforeCutoff = current.hour < hour || (current.hour === hour && current.minute < minute);
  const date = shiftCalendarDate(current, beforeCutoff ? -1 : 0);
  const next = shiftCalendarDate(date, 1);
  const start = localWallTimeToInstant({ ...date, hour, minute, timezone: configuration.timezone });
  const end = new Date(localWallTimeToInstant({ ...next, hour, minute, timezone: configuration.timezone }).getTime() - 1);
  return {
    dateFrom: start.toISOString(),
    dateTo: end.toISOString(),
    businessDate: `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`,
  };
}

export function getBusinessDate(atIso: string, configuration: BusinessDayConfiguration): string {
  return getBusinessDayRange(new Date(atIso), configuration).businessDate;
}
