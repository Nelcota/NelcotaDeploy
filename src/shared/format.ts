const LOCALE = "pt-BR";
const TIME_ZONE = "America/Sao_Paulo";
const BYTES_PER_KIBIBYTE = 1024;
const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"];
const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

const dateTimeFormat = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const timeFormat = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const shortTimeFormat = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
});
const longDateFormat = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
});
const numberFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });
const percentFormat = new Intl.NumberFormat(LOCALE, {
  style: "percent",
  maximumFractionDigits: 1,
});
const relativeFormat = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });

const UNAVAILABLE = "—";

function parseDate(isoDate: string | null | undefined): Date | undefined {
  if (isoDate == null || isoDate === "") {
    return undefined;
  }
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date;
}

/** Formats a UTC ISO date as "dd/mm/aaaa hh:mm:ss" in São Paulo time, or "—". */
export function formatDateTime(isoDate: string | null | undefined): string {
  const date = parseDate(isoDate);
  return date == null ? UNAVAILABLE : dateTimeFormat.format(date);
}

/** Formats a UTC ISO date as "hh:mm:ss" in São Paulo time, or "—". */
export function formatTime(isoDate: string | null | undefined): string {
  const date = parseDate(isoDate);
  return date == null ? UNAVAILABLE : timeFormat.format(date);
}

/** Formats a UTC ISO date as "hh:mm" in São Paulo time, for chart axes. */
export function formatShortTime(isoDate: string): string {
  const date = parseDate(isoDate);
  return date == null ? UNAVAILABLE : shortTimeFormat.format(date);
}

/**
 * Formats how long ago a date was, such as "há 5 minutos".
 *
 * @param isoDate - UTC ISO date.
 * @param now - Reference time.
 * @returns Relative time in Portuguese, or "—" for a missing date.
 */
export function formatRelativeTime(isoDate: string | null | undefined, now: Date): string {
  const date = parseDate(isoDate);
  if (date == null) {
    return UNAVAILABLE;
  }
  const seconds = Math.round((date.getTime() - now.getTime()) / MILLISECONDS_PER_SECOND);
  const absoluteSeconds = Math.abs(seconds);
  if (absoluteSeconds < SECONDS_PER_MINUTE) {
    return relativeFormat.format(seconds, "second");
  }
  const minutes = Math.round(seconds / SECONDS_PER_MINUTE);
  if (Math.abs(minutes) < MINUTES_PER_HOUR) {
    return relativeFormat.format(minutes, "minute");
  }
  const hours = Math.round(minutes / MINUTES_PER_HOUR);
  if (Math.abs(hours) < HOURS_PER_DAY) {
    return relativeFormat.format(hours, "hour");
  }
  return relativeFormat.format(Math.round(hours / HOURS_PER_DAY), "day");
}

/**
 * Formats a duration such as "1 min 05 s" or "850 ms".
 *
 * @param durationInMs - Duration in milliseconds; negative or non-finite values show "—".
 * @returns Human-readable duration.
 */
export function formatDuration(durationInMs: number | null | undefined): string {
  if (durationInMs == null || Number.isFinite(durationInMs) === false || durationInMs < 0) {
    return UNAVAILABLE;
  }
  if (durationInMs < MILLISECONDS_PER_SECOND) {
    return `${Math.round(durationInMs)} ms`;
  }
  const totalSeconds = Math.round(durationInMs / MILLISECONDS_PER_SECOND);
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  if (minutes === 0) {
    return `${seconds} s`;
  }
  return `${minutes} min ${String(seconds).padStart(2, "0")} s`;
}

/**
 * Returns the milliseconds between two ISO dates, or null when either is missing.
 *
 * @param startIso - Start date.
 * @param endIso - End date.
 * @returns Elapsed milliseconds.
 */
export function durationBetween(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
): number | null {
  const start = parseDate(startIso);
  const end = parseDate(endIso);
  if (start == null || end == null) {
    return null;
  }
  return end.getTime() - start.getTime();
}

/** Formats a byte count with binary units, such as "1,5 GB", or "—". */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || Number.isFinite(bytes) === false || bytes < 0) {
    return UNAVAILABLE;
  }
  let value = bytes;
  let unitIndex = 0;
  while (value >= BYTES_PER_KIBIBYTE && unitIndex < BYTE_UNITS.length - 1) {
    value /= BYTES_PER_KIBIBYTE;
    unitIndex += 1;
  }
  return `${numberFormat.format(value)} ${BYTE_UNITS[unitIndex] ?? "B"}`;
}

/** Formats a 0–100 percentage, such as "42,5%", or "—". */
export function formatPercent(percent: number | null | undefined): string {
  if (percent == null || Number.isFinite(percent) === false) {
    return UNAVAILABLE;
  }
  return percentFormat.format(percent / 100);
}

/**
 * Picks the singular or plural form for a count, such as "1 projeto" or "3 projetos".
 *
 * @param count - Quantity; only exactly 1 is singular.
 * @param singular - Form used for 1.
 * @param plural - Form used for every other count, including 0.
 * @returns The count followed by the matching word.
 */
export function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Formats a date as "quarta-feira, 28 de outubro" in São Paulo time.
 *
 * @param date - Instant to format.
 * @returns Weekday, day and month in Portuguese.
 */
export function formatLongDate(date: Date): string {
  return longDateFormat.format(date);
}
