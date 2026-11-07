import { describe, expect, test } from "bun:test";

import {
  DEFAULT_GUIDED_SCHEDULE,
  formatGuidedSchedule,
  parseGuidedSchedule,
  SCHEDULE_INTERVALS_IN_MINUTES,
} from "./task-schedule";

describe("parseGuidedSchedule", () => {
  test.each(["", "   "])("detects an on-demand task from %p", (expression) => {
    expect(parseGuidedSchedule(expression)?.frequency).toBe("manual");
  });

  test("detects execution every minute", () => {
    expect(parseGuidedSchedule("* * * * *")).toMatchObject({
      frequency: "interval",
      intervalInMinutes: 1,
    });
  });

  test.each(SCHEDULE_INTERVALS_IN_MINUTES)("detects a regular %d minute interval", (interval) => {
    expect(parseGuidedSchedule(`*/${interval} * * * *`)).toMatchObject({
      frequency: "interval",
      intervalInMinutes: interval,
    });
  });

  test("detects hourly execution at a specific minute", () => {
    expect(parseGuidedSchedule("17 * * * *")).toMatchObject({ frequency: "hourly", minute: 17 });
  });

  test("detects a padded daily expression with surrounding whitespace", () => {
    expect(parseGuidedSchedule("  09\t23 * * *  ")).toMatchObject({
      frequency: "daily",
      minute: 9,
      hour: 23,
    });
  });

  test("detects a weekly list including Sunday without duplicate days", () => {
    expect(parseGuidedSchedule("30 8 * * 5,0,1,1")).toMatchObject({
      frequency: "weekly",
      hour: 8,
      minute: 30,
      days: [0, 1, 5],
    });
  });

  test("detects a common weekday range", () => {
    expect(parseGuidedSchedule("0 18 * * 1-5")).toMatchObject({
      frequency: "weekly",
      hour: 18,
      minute: 0,
      days: [1, 2, 3, 4, 5],
    });
  });

  test.each([
    "15 4 1 * *",
    "0 3 * 1 *",
    "0,30 9-17 * * 1-5",
    "*/7 * * * *",
    "0 8 * * MON-FRI",
    "0 8 * * 7",
    "0 8 * * 5-1",
    "0 8 * * 1,",
    "0 8 * * 1,2,3,4,5,6,0,1",
    "60 * * * *",
    "0 24 * * *",
    "-1 3 * * *",
    "0.5 3 * * *",
    "*/0 * * * *",
    "*/60 * * * *",
    "0 3 * *",
    "0 0 3 * * *",
    "not a cron",
    "x".repeat(101),
  ])("keeps unsupported or invalid %p in the custom editor", (expression) => {
    expect(parseGuidedSchedule(expression)).toBeNull();
  });
});

describe("formatGuidedSchedule", () => {
  test("does not schedule an on-demand task", () => {
    expect(formatGuidedSchedule(DEFAULT_GUIDED_SCHEDULE)).toBe("");
  });

  test("generates execution every minute", () => {
    expect(
      formatGuidedSchedule({
        ...DEFAULT_GUIDED_SCHEDULE,
        frequency: "interval",
        intervalInMinutes: 1,
      }),
    ).toBe("* * * * *");
  });

  test.each(SCHEDULE_INTERVALS_IN_MINUTES)(
    "round trips the regular %d minute interval",
    (intervalInMinutes) => {
      const expression = formatGuidedSchedule({
        ...DEFAULT_GUIDED_SCHEDULE,
        frequency: "interval",
        intervalInMinutes,
      });

      expect(parseGuidedSchedule(expression)).toMatchObject({
        frequency: "interval",
        intervalInMinutes,
      });
    },
  );

  test("generates hourly execution at the last minute", () => {
    expect(
      formatGuidedSchedule({ ...DEFAULT_GUIDED_SCHEDULE, frequency: "hourly", minute: 59 }),
    ).toBe("59 * * * *");
  });

  test("generates daily execution at midnight", () => {
    expect(
      formatGuidedSchedule({ ...DEFAULT_GUIDED_SCHEDULE, frequency: "daily", hour: 0, minute: 0 }),
    ).toBe("0 0 * * *");
  });

  test("generates weekly execution without mutating the selected days", () => {
    const days = Object.freeze([6, 0, 1, 0]);
    const expression = formatGuidedSchedule({
      ...DEFAULT_GUIDED_SCHEDULE,
      frequency: "weekly",
      hour: 23,
      minute: 59,
      days,
    });

    expect(expression).toBe("59 23 * * 0,1,6");
    expect(days).toEqual([6, 0, 1, 0]);
  });
});

describe("formatGuidedSchedule validation", () => {
  test.each([0, -1, 7, 60, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid interval %p",
    (intervalInMinutes) => {
      expect(() =>
        formatGuidedSchedule({
          ...DEFAULT_GUIDED_SCHEDULE,
          frequency: "interval",
          intervalInMinutes,
        }),
      ).toThrow(RangeError);
    },
  );

  test.each([-1, 60, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid minute %p",
    (minute) => {
      expect(() =>
        formatGuidedSchedule({ ...DEFAULT_GUIDED_SCHEDULE, frequency: "hourly", minute }),
      ).toThrow(RangeError);
    },
  );

  test.each([-1, 24, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid hour %p",
    (hour) => {
      expect(() =>
        formatGuidedSchedule({ ...DEFAULT_GUIDED_SCHEDULE, frequency: "daily", hour }),
      ).toThrow(RangeError);
    },
  );

  test.each(
    [[], [-1], [7], [1.5], [Number.NaN], [Number.POSITIVE_INFINITY], [0, 1, 2, 3, 4, 5, 6, 0]].map(
      (days) => ({ days }),
    ),
  )("rejects invalid weekday list %p", ({ days }) => {
    expect(() =>
      formatGuidedSchedule({ ...DEFAULT_GUIDED_SCHEDULE, frequency: "weekly", days }),
    ).toThrow(RangeError);
  });
});

describe("guided schedules interpreted by the task scheduler", () => {
  const after = new Date("2026-11-06T12:07:00Z");
  test.each([
    {
      schedule: {
        ...DEFAULT_GUIDED_SCHEDULE,
        frequency: "interval" as const,
        intervalInMinutes: 15,
      },
      expected: "2026-11-06T12:15:00.000Z",
    },
    {
      schedule: { ...DEFAULT_GUIDED_SCHEDULE, frequency: "hourly" as const, minute: 59 },
      expected: "2026-11-06T12:59:00.000Z",
    },
    {
      schedule: { ...DEFAULT_GUIDED_SCHEDULE, frequency: "daily" as const, hour: 8, minute: 30 },
      expected: "2026-11-07T11:30:00.000Z",
    },
    {
      schedule: {
        ...DEFAULT_GUIDED_SCHEDULE,
        frequency: "weekly" as const,
        hour: 18,
        minute: 30,
        days: [1, 5],
      },
      expected: "2026-11-06T21:30:00.000Z",
    },
    {
      schedule: {
        ...DEFAULT_GUIDED_SCHEDULE,
        frequency: "weekly" as const,
        hour: 0,
        minute: 0,
        days: [0],
      },
      expected: "2026-11-08T03:00:00.000Z",
    },
  ])(
    "computes the expected UTC execution from %p in the panel time zone",
    ({ schedule, expected }) => {
      const expression = formatGuidedSchedule(schedule);
      const next = Bun.cron.parse(expression, after, { tz: "America/Sao_Paulo" });

      expect(next?.toISOString()).toBe(expected);
    },
  );
});
