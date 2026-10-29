import { describe, expect, test } from "bun:test";

import { openMemoryDatabase } from "@/db";
import { createTestProject } from "@/testing";

import { appendRuntimeLogs, listRuntimeLogs } from "./log.service";

const CREATED_AT = "2026-10-28T12:00:00.000Z";
// Above the 8192 characters the service keeps per line.
const LONG_LINE_LENGTH = 16_384;

describe("appendRuntimeLogs", () => {
  test("stores lines without terminal color codes", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);

    appendRuntimeLogs(database, [
      {
        projectId: project.id,
        deploymentId: null,
        stream: "stdout",
        message: "\u001b[32mINFO\u001b[0m server listening on \u001b[1m3000\u001b[22m",
        createdAt: CREATED_AT,
      },
    ]);

    const [line] = listRuntimeLogs(database, project.id, { limit: 10 });
    expect(line?.message).toBe("INFO server listening on 3000");
  });

  test("cuts lines longer than the limit", () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);

    appendRuntimeLogs(database, [
      {
        projectId: project.id,
        deploymentId: null,
        stream: "stdout",
        message: "a".repeat(LONG_LINE_LENGTH),
        createdAt: CREATED_AT,
      },
    ]);

    const [line] = listRuntimeLogs(database, project.id, { limit: 10 });
    expect(line?.message.endsWith("…")).toBe(true);
  });
});
