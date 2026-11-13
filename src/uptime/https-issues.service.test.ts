import { expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { type Database, openMemoryDatabase, tables } from "@/db";
import { addDomain } from "@/domains";
import { createTestProject, TEST_ACTOR } from "@/testing";

import { listHttpsStatus } from "./https-issues.service";
import { recordUptimeCheck } from "./uptime.service";

const NOW = new Date("2026-11-13T15:00:00Z");
const BEFORE_RELEASE = new Date("2026-11-13T14:58:00Z");
const FAILURE = {
  kind: "checked",
  up: false,
  statusCode: null,
  responseTimeInMs: null,
  reason: "certificate",
} as const;
const SUCCESS = {
  kind: "checked",
  up: true,
  statusCode: 200,
  responseTimeInMs: 10,
  reason: null,
} as const;

function publish(database: Database, slug: string) {
  const project = createTestProject(database, { slug, name: slug });
  const id = crypto.randomUUID();
  database
    .insert(tables.deployments)
    .values({
      id,
      projectId: project.id,
      branch: "main",
      trigger: "manual",
      triggeredByLabel: "test",
      status: "succeeded",
      createdAt: "2026-11-13T14:57:00Z",
      finishedAt: "2026-11-13T14:59:00Z",
    })
    .run();
  database
    .update(tables.projects)
    .set({ currentDeploymentId: id })
    .where(eq(tables.projects.id, project.id))
    .run();
  return project.id;
}

function failDomain(
  database: Database,
  projectId: string,
  {
    hostname,
    checkedAt = NOW,
    httpsEnabled = true,
  }: {
    readonly hostname: string;
    readonly checkedAt?: Date;
    readonly httpsEnabled?: boolean;
  },
) {
  addDomain(database, { projectId, input: { hostname, httpsEnabled }, actor: TEST_ACTOR });
  recordUptimeCheck(database, { target: { projectId, hostname }, result: FAILURE, checkedAt });
}

test("lists exact HTTPS domains for visible projects and removes a failure after recovery", () => {
  const database = openMemoryDatabase();
  const visible = publish(database, "visible");
  const hidden = publish(database, "hidden");
  failDomain(database, visible, { hostname: "www.example.com" });
  failDomain(database, visible, { hostname: "app.example.com" });
  failDomain(database, hidden, { hostname: "private-project.example.com" });

  expect(listHttpsStatus(database, NOW, [visible]).issues).toEqual([
    { projectId: visible, projectName: "visible", hostname: "app.example.com" },
    { projectId: visible, projectName: "visible", hostname: "www.example.com" },
  ]);

  recordUptimeCheck(database, {
    target: { projectId: visible, hostname: "app.example.com" },
    result: SUCCESS,
    checkedAt: NOW,
  });
  const status = listHttpsStatus(database, NOW, [visible]);
  expect(status.issues.map((domain) => domain.hostname)).toEqual(["www.example.com"]);
  expect(status.recoveries).toEqual([
    {
      projectId: visible,
      projectName: "visible",
      hostname: "app.example.com",
      recoveredAt: NOW.toISOString(),
    },
  ]);
  expect(listHttpsStatus(database, NOW, [hidden]).recoveries).toEqual([]);
  expect(listHttpsStatus(database, NOW, [])).toEqual({ issues: [], recoveries: [] });
});

test("excludes HTTP domains, checks from older releases and stale failures", () => {
  const database = openMemoryDatabase();
  const projectId = publish(database, "app");
  failDomain(database, projectId, { hostname: "http.example.com", httpsEnabled: false });
  failDomain(database, projectId, {
    hostname: "old-release.example.com",
    checkedAt: BEFORE_RELEASE,
  });
  failDomain(database, projectId, { hostname: "stale.example.com" });

  expect(listHttpsStatus(database, NOW, null).issues.map((domain) => domain.hostname)).toEqual([
    "stale.example.com",
  ]);
  expect(listHttpsStatus(database, new Date("2026-11-13T15:04:00Z"), null).issues).toEqual([]);
});

test("keeps the initial recovery time through later checks and stops showing stale recoveries", () => {
  const database = openMemoryDatabase();
  const projectId = publish(database, "app");
  const hostname = "app.example.com";
  const target = { projectId, hostname };
  failDomain(database, projectId, { hostname, checkedAt: new Date("2026-11-13T14:45:00Z") });
  recordUptimeCheck(database, { target, result: SUCCESS, checkedAt: NOW });

  const later = new Date("2026-11-13T15:20:00Z");
  recordUptimeCheck(database, { target, result: SUCCESS, checkedAt: later });
  expect(listHttpsStatus(database, later, null).recoveries.at(0)?.recoveredAt).toBe(
    NOW.toISOString(),
  );
  expect(listHttpsStatus(database, new Date("2026-11-13T15:24:00Z"), null).recoveries).toEqual([]);

  const expired = new Date("2026-11-13T15:31:00Z");
  recordUptimeCheck(database, { target, result: SUCCESS, checkedAt: expired });
  expect(listHttpsStatus(database, expired, null).recoveries).toEqual([]);
});

test("stops showing a recovery when the latest observation fails or becomes private", () => {
  const database = openMemoryDatabase();
  const projectId = publish(database, "app");
  const hostname = "app.example.com";
  const target = { projectId, hostname };
  failDomain(database, projectId, { hostname, checkedAt: BEFORE_RELEASE });
  recordUptimeCheck(database, { target, result: SUCCESS, checkedAt: NOW });
  expect(listHttpsStatus(database, NOW, null).recoveries).toHaveLength(1);

  recordUptimeCheck(database, { target, result: { kind: "private" }, checkedAt: NOW });
  expect(listHttpsStatus(database, NOW, null).recoveries).toEqual([]);

  recordUptimeCheck(database, { target, result: { ...FAILURE, reason: "dns" }, checkedAt: NOW });
  expect(listHttpsStatus(database, NOW, null)).toEqual({ issues: [], recoveries: [] });
});
