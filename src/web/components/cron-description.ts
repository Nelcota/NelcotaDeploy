const CRON_FIELD_COUNT = 5;
const MAX_MINUTE = 59;
const MAX_HOUR = 23;
const MAX_DAY_OF_MONTH = 31;
// Cron accepts both 0 and 7 for Sunday.
const MAX_WEEKDAY = 7;
const WORKDAYS = "1-5";
const INTEGER = /^\d{1,2}$/;
const EVERY_N_MINUTES = /^\*\/(\d{1,2})$/;

const WEEKDAY_PHRASES = [
  "Todo domingo",
  "Toda segunda-feira",
  "Toda terça-feira",
  "Toda quarta-feira",
  "Toda quinta-feira",
  "Toda sexta-feira",
  "Todo sábado",
  "Todo domingo",
] as const;

function parseInRange(field: string, max: number): number | null {
  if (INTEGER.test(field) === false) {
    return null;
  }
  const value = Number(field);
  return value <= max ? value : null;
}

function clock(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function describeEveryMinutes(minuteField: string): string | null {
  if (minuteField === "*") {
    return "A cada minuto";
  }
  const step = EVERY_N_MINUTES.exec(minuteField)?.[1];
  if (step == null) {
    return null;
  }
  const minutes = Number(step);
  if (minutes < 1 || minutes > MAX_MINUTE) {
    return null;
  }
  return minutes === 1 ? "A cada minuto" : `A cada ${minutes} minutos`;
}

function describeWeekday(weekdayField: string, time: string): string | null {
  if (weekdayField === WORKDAYS) {
    return `De segunda a sexta às ${time}`;
  }
  const weekday = parseInRange(weekdayField, MAX_WEEKDAY);
  if (weekday == null) {
    return null;
  }
  return `${WEEKDAY_PHRASES[weekday] ?? ""} às ${time}`;
}

/**
 * Describes the common shapes of a 5-field cron expression in Portuguese, such as
 * "Todo dia às 03:00".
 *
 * @param schedule - Cron expression: minute, hour, day of month, month and weekday.
 * @returns A short sentence, or null when the expression is not one of the shapes described
 * (every N minutes, hourly, daily, weekly, weekdays or monthly); show the raw cron then.
 *
 * @example
 * describeCronSchedule("0 3 * * *"); // "Todo dia às 03:00"
 * describeCronSchedule("30 8 * * 1"); // "Toda segunda-feira às 08:30"
 */
export function describeCronSchedule(schedule: string): string | null {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== CRON_FIELD_COUNT) {
    return null;
  }
  const [minuteField = "", hourField = "", dayField = "", monthField = "", weekdayField = ""] =
    fields;
  if (monthField !== "*") {
    return null;
  }
  if (hourField === "*" && dayField === "*" && weekdayField === "*") {
    const minute = parseInRange(minuteField, MAX_MINUTE);
    if (minute != null) {
      return minute === 0 ? "A cada hora" : `A cada hora, no minuto ${minute}`;
    }
    return describeEveryMinutes(minuteField);
  }
  const minute = parseInRange(minuteField, MAX_MINUTE);
  const hour = parseInRange(hourField, MAX_HOUR);
  if (minute == null || hour == null) {
    return null;
  }
  const time = clock(hour, minute);
  if (dayField === "*" && weekdayField === "*") {
    return `Todo dia às ${time}`;
  }
  if (dayField === "*") {
    return describeWeekday(weekdayField, time);
  }
  const day = parseInRange(dayField, MAX_DAY_OF_MONTH);
  if (day == null || day === 0 || weekdayField !== "*") {
    return null;
  }
  return `Todo dia ${day} do mês às ${time}`;
}
