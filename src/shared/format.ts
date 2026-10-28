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
// "en-CA" formats dates as YYYY-MM-DD, a stable key for "same calendar day" comparisons.
const dayKeyFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
// Calendar days are formatted at noon UTC so no time zone can move them to another date.
const shortDayFormat = new Intl.DateTimeFormat(LOCALE, {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
});
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;
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
 * Converts bytes to mebibytes, so a memory chart can place its ticks on round numbers.
 *
 * @param bytes - Size in bytes; null, negative or non-finite values give null.
 * @returns The size in MiB, or null when it is not a usable number.
 */
export function bytesToMebibytes(bytes: number | null | undefined): number | null {
  if (bytes == null || Number.isFinite(bytes) === false || bytes < 0) {
    return null;
  }
  return bytes / (BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE);
}

/**
 * Formats a size given in mebibytes, such as "240 MB".
 *
 * @param mebibytes - Size in MiB.
 * @returns Human-readable size, or "—" for a value that is not a usable number.
 */
export function formatMebibytes(mebibytes: number): string {
  return formatBytes(mebibytes * BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE);
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

const MILLISECONDS_PER_DAY =
  HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND;

/**
 * Returns the calendar day of an instant in São Paulo time.
 *
 * @param isoDate - UTC ISO 8601 date.
 * @returns The day as "YYYY-MM-DD", or null when the date is invalid.
 *
 * @example
 * dayKey("2026-10-29T01:00:00Z"); // "2026-10-28" (22:00 in São Paulo)
 */
export function dayKey(isoDate: string): string | null {
  const date = parseDate(isoDate);
  return date == null ? null : dayKeyFormat.format(date);
}

/**
 * Names the day of an instant for a list heading: "Hoje", "Ontem" or the long date.
 *
 * @param isoDate - UTC ISO 8601 date.
 * @param now - Current instant, which decides what "today" is.
 * @returns The heading in Portuguese, or "—" when the date is invalid.
 */
export function formatDayHeading(isoDate: string, now: Date): string {
  const date = parseDate(isoDate);
  if (date == null) {
    return UNAVAILABLE;
  }
  const day = dayKeyFormat.format(date);
  if (day === dayKeyFormat.format(now)) {
    return "Hoje";
  }
  if (day === dayKeyFormat.format(new Date(now.getTime() - MILLISECONDS_PER_DAY))) {
    return "Ontem";
  }
  return longDateFormat.format(date);
}

/**
 * Formats a calendar day key as a short label for a chart axis, such as "seg., 26".
 *
 * @param day - Day as "YYYY-MM-DD", like the keys from {@link dayKey}.
 * @returns Short weekday and day of month, or "—" when the key is not a valid date.
 */
export function formatShortDay(day: string): string {
  if (CALENDAR_DAY.test(day) === false) {
    return UNAVAILABLE;
  }
  const date = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? UNAVAILABLE : shortDayFormat.format(date);
}
