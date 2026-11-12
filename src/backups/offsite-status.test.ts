import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getConfig } from "@/config";

import { summarizeBackups } from "./backup-summary";
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

    await recordOffsiteStatus(folder, { at: new Date("2026-10-29T03:30:00Z"), failed: true });

    expect(await readOffsiteStatus(folder)).toEqual({
      attemptedAt: "2026-10-29T03:30:00.000Z",
      uploadedAt: "2026-10-28T03:30:00.000Z",
      key: "a.enc",
      error: "Offsite backup upload failed",
    });
  });

  test("treats a damaged file as unknown", async () => {
    const folder = await directory();
    await Bun.write(join(folder, "offsite-status.json"), "{not json");

    expect(await readOffsiteStatus(folder)).toBeNull();
  });
});

test("keeps legacy diagnostics and remote keys out of the panel summary", async () => {
  const folder = await directory();
  await Bun.write(
    join(folder, "offsite-status.json"),
    JSON.stringify({
      attemptedAt: "2026-10-29T03:30:00.000Z",
      uploadedAt: "2026-10-28T03:30:00.000Z",
      key: "private-backup.enc",
      error: "unfiltered storage diagnostic",
    }),
  );

  const summary = await summarizeBackups({ ...getConfig(), BACKUP_DIR: folder });

  expect(summary.offsite.status).toEqual({
    attemptedAt: "2026-10-29T03:30:00.000Z",
    uploadedAt: "2026-10-28T03:30:00.000Z",
    error: "Offsite backup upload failed",
  });
});
