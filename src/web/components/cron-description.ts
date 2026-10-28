import cronstrue from "cronstrue/i18n";

/**
 * Describes a cron expression in Portuguese, such as "Às 03:00, de segunda-feira a
 * sexta-feira".
 *
 * @param schedule - Cron expression: minute, hour, day of month, month and weekday.
 * @returns A short sentence, or null when the expression cannot be read; show the raw cron then.
 *
 * @example
 * describeCronSchedule("0 3 * * *"); // "Às 03:00"
 * describeCronSchedule("*\/15 * * * *"); // "A cada 15 minutos"
 */
export function describeCronSchedule(schedule: string): string | null {
  if (schedule.trim() === "") {
    return null;
  }
  try {
    return cronstrue.toString(schedule, {
      locale: "pt_BR",
      use24HourTimeFormat: true,
      throwExceptionOnParseError: true,
    });
  } catch {
    // An unreadable expression is expected while the user is still typing it.
    return null;
  }
}
