import { expect, test } from "bun:test";

import { acquireBackupMemory } from "./backup-memory";

test("serializes backup memory reservations and releases them after failure", async () => {
  using first = await acquireBackupMemory();
  let entered = false;
  const waiting = acquireBackupMemory().then((reservation) => {
    entered = true;
    return reservation;
  });
  await Promise.resolve();
  expect(entered).toBe(false);
  first[Symbol.dispose]();
  using _second = await waiting;
  expect(entered).toBe(true);
});

test("cancels a queued reservation without allowing its successor to overtake the owner", async () => {
  using first = await acquireBackupMemory();
  const controller = new AbortController();
  const cancelled = acquireBackupMemory(controller.signal).catch((error: unknown) => error);
  let entered = false;
  const next = acquireBackupMemory().then((reservation) => {
    entered = true;
    return reservation;
  });
  controller.abort();
  expect(await cancelled).toBeInstanceOf(Error);
  await Promise.resolve();
  expect(entered).toBe(false);
  first[Symbol.dispose]();
  using _next = await next;
  expect(entered).toBe(true);
});
