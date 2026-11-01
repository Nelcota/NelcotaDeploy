import { expect, test } from "bun:test";

import { openMemoryDatabase, tables } from "@/db";
import { TEST_ACTOR } from "@/testing";

import { listAuditEvents, recordAuditEvent } from "./audit.service";

test("paginates every audit event when creation timestamps are identical", () => {
  const database = openMemoryDatabase();
  using _connection = database.$client;
  recordAuditEvent(database, { actor: TEST_ACTOR, action: "first", targetType: "test" });
  recordAuditEvent(database, { actor: TEST_ACTOR, action: "second", targetType: "test" });
  database.update(tables.auditEvents).set({ createdAt: "2026-11-01T12:00:00.000Z" }).run();
  const first = listAuditEvents(database, { limit: 1 }).at(0);
  if (first == null) {
    throw new Error("Missing test audit event");
  }

  const second = listAuditEvents(database, {
    limit: 1,
    before: { createdAt: first.createdAt, id: first.id },
  });

  expect(second).toHaveLength(1);
  expect(second.at(0)?.id).not.toBe(first.id);
});
