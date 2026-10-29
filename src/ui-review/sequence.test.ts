import { describe, expect, test } from "bun:test";

import { mapInSequence } from "./sequence";

describe("mapInSequence", () => {
  test("returns an empty list when there are no items", async () => {
    const step = async (item: number) => await Promise.resolve(item);

    const results = await mapInSequence([], step);

    expect(results).toEqual([]);
  });

  test("returns the results in item order", async () => {
    const step = async (item: number) => await Promise.resolve(item * 10);

    const results = await mapInSequence([1, 2, 3], step);

    expect(results).toEqual([10, 20, 30]);
  });

  test("starts each step only after the previous one finished", async () => {
    const events: string[] = [];
    const stepDurationInMs = 1;
    const step = async (item: string) => {
      events.push(`start ${item}`);
      await Bun.sleep(stepDurationInMs);
      events.push(`end ${item}`);
    };

    await mapInSequence(["a", "b"], step);

    expect(events).toEqual(["start a", "end a", "start b", "end b"]);
  });
});
