import { describe, expect, test } from "bun:test";

import { describeCronSchedule } from "./cron-description";

describe("describeCronSchedule", () => {
  test.each([
    ["* * * * *", "A cada minuto"],
    ["*/15 * * * *", "A cada 15 minutos"],
    ["0 * * * *", "A cada hora"],
    ["5 * * * *", "A cada hora, no minuto 5"],
    ["0 3 * * *", "Todo dia às 03:00"],
    ["30 8 * * 1", "Toda segunda-feira às 08:30"],
    ["0 9 * * 0", "Todo domingo às 09:00"],
    ["0 9 * * 7", "Todo domingo às 09:00"],
    ["0 18 * * 1-5", "De segunda a sexta às 18:00"],
    ["15 4 1 * *", "Todo dia 1 do mês às 04:15"],
  ])("describes %p as %p", (schedule, expected) => {
    const description = describeCronSchedule(schedule);

    expect(description).toBe(expected);
  });

  test("ignores extra spaces around and between fields", () => {
    const description = describeCronSchedule("  0   3 * *  * ");

    expect(description).toBe("Todo dia às 03:00");
  });

  test.each(["", "   ", "0 3 * *", "0 3 * * * *"])(
    "returns null for %p, which does not have five fields",
    (schedule) => {
      const description = describeCronSchedule(schedule);

      expect(description).toBeNull();
    },
  );

  test.each(["60 3 * * *", "0 24 * * *", "0 3 32 * *", "0 3 0 * *", "0 3 * * 8", "*/0 * * * *"])(
    "returns null for %p, which is out of range",
    (schedule) => {
      const description = describeCronSchedule(schedule);

      expect(description).toBeNull();
    },
  );

  test.each(["0 3 * 1 *", "0 3 1 * 1", "0 */2 * * *", "0,30 * * * *", "0 3 * * MON"])(
    "returns null for %p, a shape it does not describe",
    (schedule) => {
      const description = describeCronSchedule(schedule);

      expect(description).toBeNull();
    },
  );
});
