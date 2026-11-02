import { expect, test } from "bun:test";

import { openMemoryDatabase } from "@/db";

import { recordServerCleanup } from "./server-cleanup.service";
import { getServer, LOCAL_SERVER_ID } from "./server.service";

const CLEANUP_AT = new Date("2026-11-02T04:30:00Z");

test.each([0, 1_500_000_000])("records a cleanup that freed %d bytes", (freedBytes) => {
  const database = openMemoryDatabase();

  recordServerCleanup(database, LOCAL_SERVER_ID, { at: CLEANUP_AT, freedBytes });

  const server = getServer(database, LOCAL_SERVER_ID);
  expect(server.lastCleanupAt).toBe(CLEANUP_AT.toISOString());
  expect(server.lastCleanupFreedBytes).toBe(freedBytes);
});

test.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
  "rejects the invalid cleanup byte count %s without replacing the previous result",
  (freedBytes) => {
    const database = openMemoryDatabase();
    recordServerCleanup(database, LOCAL_SERVER_ID, { at: CLEANUP_AT, freedBytes: 0 });

    expect(() =>
      recordServerCleanup(database, LOCAL_SERVER_ID, { at: CLEANUP_AT, freedBytes }),
    ).toThrow(RangeError);

    expect(getServer(database, LOCAL_SERVER_ID).lastCleanupFreedBytes).toBe(0);
  },
);

test("rejects an invalid cleanup timestamp before recording anything", () => {
  const database = openMemoryDatabase();

  expect(() =>
    recordServerCleanup(database, LOCAL_SERVER_ID, { at: new Date(Number.NaN), freedBytes: 0 }),
  ).toThrow(RangeError);

  expect(getServer(database, LOCAL_SERVER_ID).lastCleanupAt).toBeNull();
});
