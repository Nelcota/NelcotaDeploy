/** Frequencies supported by the guided editor; other expressions keep the custom editor. */
type ScheduleFrequency = "manual" | "interval" | "hourly" | "daily" | "weekly";

/** Editable parts of a schedule, interpreted in the panel's configured time zone. */
export type GuidedSchedule = {
  readonly frequency: ScheduleFrequency;
  readonly intervalInMinutes: number;
  readonly hour: number;
  readonly minute: number;
  readonly days: readonly number[];
};

const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const DAYS_PER_WEEK = 7;
const CRON_FIELD_COUNT = 5;
const MAX_SCHEDULE_LENGTH = 100;

// Only divisors of an hour keep the same interval across hour boundaries.
export const SCHEDULE_INTERVALS_IN_MINUTES: readonly number[] = Array.from(
  { length: MINUTES_PER_HOUR - 1 },
  (_, index) => index + 1,
).filter((interval) => MINUTES_PER_HOUR % interval === 0);
export const DEFAULT_GUIDED_SCHEDULE: GuidedSchedule = {
  frequency: "manual",
  intervalInMinutes: 15,
  hour: 3,
  minute: 0,
  days: [1],
};

function cronNumber(value: string | undefined, maximum: number): number | null {
  if (value == null || /^\d{1,2}$/.test(value) === false) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= maximum ? number : null;
}

function parseWeekdays(value: string): readonly number[] | null {
  const range = /^([0-6])-([0-6])$/.exec(value);
  if (range != null) {
    const first = cronNumber(range.at(1), DAYS_PER_WEEK - 1);
    const last = cronNumber(range.at(2), DAYS_PER_WEEK - 1);
    if (first == null || last == null || first > last) {
      return null;
    }
    return Array.from({ length: last - first + 1 }, (_, index) => first + index);
  }
  if (/^[0-6](?:,[0-6]){0,6}$/.test(value) === false) {
    return null;
  }
  const days = value.split(",").map(Number);
  if (days.some((day) => Number.isFinite(day) === false)) {
    return null;
  }
  return [...new Set(days)].toSorted((left, right) => left - right);
}

/**
 * Detects common cron expressions without replacing unsupported or invalid expressions.
 *
 * @param expression - Saved or currently typed five-field cron expression.
 * @returns Guided values, or null when the custom editor must preserve the expression.
 */
export function parseGuidedSchedule(expression: string): GuidedSchedule | null {
  const trimmed = expression.trim();
  if (trimmed === "") {
    return DEFAULT_GUIDED_SCHEDULE;
  }
  if (trimmed.length > MAX_SCHEDULE_LENGTH) {
    return null;
  }
  const fields = trimmed.split(/\s+/);
  const [minuteField, hourField, dayField, monthField, weekdayField] = fields;
  if (fields.length !== CRON_FIELD_COUNT || dayField !== "*" || monthField !== "*") {
    return null;
  }
  if (hourField === "*" && weekdayField === "*") {
    return parseHourlySchedule(minuteField);
  }
  return parseCalendarSchedule(minuteField, hourField, weekdayField);
}

function parseCalendarSchedule(
  minuteField: string | undefined,
  hourField: string | undefined,
  weekdayField: string | undefined,
): GuidedSchedule | null {
  const minute = cronNumber(minuteField, MINUTES_PER_HOUR - 1);
  const hour = cronNumber(hourField, HOURS_PER_DAY - 1);
  if (minute == null || hour == null || weekdayField == null) {
    return null;
  }
  if (weekdayField === "*") {
    return { ...DEFAULT_GUIDED_SCHEDULE, frequency: "daily", hour, minute };
  }
  const days = parseWeekdays(weekdayField);
  return days == null
    ? null
    : { ...DEFAULT_GUIDED_SCHEDULE, frequency: "weekly", hour, minute, days };
}

function parseHourlySchedule(minuteField: string | undefined): GuidedSchedule | null {
  if (minuteField === "*") {
    return { ...DEFAULT_GUIDED_SCHEDULE, frequency: "interval", intervalInMinutes: 1 };
  }
  const interval =
    minuteField?.startsWith("*/") === true
      ? cronNumber(minuteField.slice(2), MINUTES_PER_HOUR - 1)
      : null;
  if (interval != null && SCHEDULE_INTERVALS_IN_MINUTES.some((value) => value === interval)) {
    return { ...DEFAULT_GUIDED_SCHEDULE, frequency: "interval", intervalInMinutes: interval };
  }
  const minute = cronNumber(minuteField, MINUTES_PER_HOUR - 1);
  return minute == null ? null : { ...DEFAULT_GUIDED_SCHEDULE, frequency: "hourly", minute };
}

function assertScheduleNumber(value: number, maximum: number): void {
  if (
    Number.isFinite(value) === false ||
    Number.isInteger(value) === false ||
    value < 0 ||
    value > maximum
  ) {
    throw new RangeError(
      `Schedule value must be an integer between 0 and ${maximum}, received ${value}`,
    );
  }
}

/**
 * Builds a five-field cron expression from valid guided controls.
 *
 * @param schedule - Selected frequency, time and weekdays.
 * @returns A cron expression, or an empty string for a task that runs only on demand.
 * @throws {RangeError} When an active control has an invalid number, interval or weekday list.
 */
export function formatGuidedSchedule(schedule: GuidedSchedule): string {
  if (schedule.frequency === "manual") {
    return "";
  }
  if (schedule.frequency === "interval") {
    if (
      SCHEDULE_INTERVALS_IN_MINUTES.some((value) => value === schedule.intervalInMinutes) === false
    ) {
      throw new RangeError(`Unsupported schedule interval: ${schedule.intervalInMinutes}`);
    }
    return schedule.intervalInMinutes === 1
      ? "* * * * *"
      : `*/${schedule.intervalInMinutes} * * * *`;
  }
  assertScheduleNumber(schedule.minute, MINUTES_PER_HOUR - 1);
  if (schedule.frequency === "hourly") {
    return `${schedule.minute} * * * *`;
  }
  assertScheduleNumber(schedule.hour, HOURS_PER_DAY - 1);
  if (schedule.frequency === "daily") {
    return `${schedule.minute} ${schedule.hour} * * *`;
  }
  if (schedule.days.length === 0 || schedule.days.length > DAYS_PER_WEEK) {
    throw new RangeError("A weekly schedule must include between one and seven days");
  }
  for (const day of schedule.days) {
    assertScheduleNumber(day, DAYS_PER_WEEK - 1);
  }
  const days = [...new Set(schedule.days)].toSorted((left, right) => left - right);
  return `${schedule.minute} ${schedule.hour} * * ${days.join(",")}`;
}
