import { describe, expect, test } from "bun:test";

import { describeCronSchedule } from "@/web/components/projects/cron-description";

describe("describeCronSchedule", () => {
  test.each([
    ["* * * * *", "A cada minuto"],
    ["*/15 * * * *", "A cada 15 minutos"],
    ["0 * * * *", "A cada hora"],
    ["0 3 * * *", "Às 03:00"],
    ["30 8 * * 1", "Às 08:30, somente de segunda-feira"],
    ["0 18 * * 1-5", "Às 18:00, de segunda-feira a sexta-feira"],
    ["15 4 1 * *", "Às 04:15, no dia 1 do mês"],
    ["0 3 * 1 *", "Às 03:00, somente em janeiro"],
  ])("describes %p as %p", (schedule, expected) => {
    expect(describeCronSchedule(schedule)).toBe(expected);
  });

  test("describes lists and ranges too", () => {
    expect(describeCronSchedule("0,30 9-17 * * 1-5")).toBe(
      "Aos 0 e 30 minutos da hora, entre 09:00 e 17:59, de segunda-feira a sexta-feira",
    );
  });

  test.each(["", "   ", "0 3 * *x", "60 3 * * *", "not a cron"])(
    "returns null for %p",
    (schedule) => {
      expect(describeCronSchedule(schedule)).toBeNull();
    },
  );
});
