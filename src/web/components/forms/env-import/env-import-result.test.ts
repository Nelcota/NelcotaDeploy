import { describe, expect, test } from "bun:test";

import { summarizeEnvImport } from "@/web/components/forms/env-import/env-import-result";

describe("summarizeEnvImport", () => {
  test("counts every variable as saved when nothing failed", () => {
    const outcomes = [
      { entry: { key: "A", value: "1" }, saved: true },
      { entry: { key: "B", value: "2" }, saved: true },
    ];

    const result = summarizeEnvImport(outcomes);

    expect(result).toEqual({ savedCount: 2, failedKeys: [], remainingText: "" });
  });

  test("keeps only the failed lines, in paste order", () => {
    const outcomes = [
      { entry: { key: "A", value: "1" }, saved: false },
      { entry: { key: "B", value: "2" }, saved: true },
      { entry: { key: "C", value: "x=y" }, saved: false },
    ];

    const result = summarizeEnvImport(outcomes);

    expect(result).toEqual({ savedCount: 1, failedKeys: ["A", "C"], remainingText: "A=1\nC=x=y" });
  });

  test("returns an empty summary for an empty import", () => {
    const result = summarizeEnvImport([]);

    expect(result).toEqual({ savedCount: 0, failedKeys: [], remainingText: "" });
  });
});
