import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readOffsiteStatus, recordOffsiteStatus } from "./offsite-status";

async function directory(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "nelcota-status-"));
}

describe("offsite status", () => {
  test("is unknown before the first upload", async () => {
    expect(await readOffsiteStatus(await directory())).toBeNull();
  });

  test("keeps the last success when a later upload fails", async () => {
    const folder = await directory();
    await recordOffsiteStatus(folder, { at: new Date("2026-10-28T03:30:00Z"), key: "a.enc" });

    await recordOffsiteStatus(folder, { at: new Date("2026-10-29T03:30:00Z"), error: "timeout" });

    expect(await readOffsiteStatus(folder)).toEqual({
      attemptedAt: "2026-10-29T03:30:00.000Z",
      uploadedAt: "2026-10-28T03:30:00.000Z",
      key: "a.enc",
      error: "timeout",
    });
  });

  test("treats a damaged file as unknown", async () => {
    const folder = await directory();
    await Bun.write(join(folder, "offsite-status.json"), "{not json");

    expect(await readOffsiteStatus(folder)).toBeNull();
  });
});
