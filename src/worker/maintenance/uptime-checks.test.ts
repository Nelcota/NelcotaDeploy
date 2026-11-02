import { describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { getConfig } from "@/config";
import { type Database, openMemoryDatabase, tables } from "@/db";
import { listLiveDomains } from "@/domains";
import { createLogger } from "@/logging";
import { getSystemSettings, saveSystemSettings } from "@/settings";
import { createTestProject } from "@/testing";
import { listUptimeSummaries, type ProbeTools } from "@/uptime";

import { checkCertificates, checkUptime } from "./uptime-checks";

const PUBLIC_ADDRESS = "93.184.215.14";
const DAY_IN_MS = 86_400_000;

/** Creates a project with a live deployment and a custom domain. */
function liveProject(database: Database, slug: string, hostname: string) {
  const project = createTestProject(database, { name: slug, slug });
  const deploymentId = crypto.randomUUID();
  database
    .insert(tables.deployments)
    .values({
      id: deploymentId,
      projectId: project.id,
      trigger: "manual",
      triggeredByLabel: "test",
      branch: "main",
      status: "succeeded",
      createdAt: new Date().toISOString(),
    })
    .run();
  database
    .update(tables.projects)
    .set({ currentDeploymentId: deploymentId })
    .where(eq(tables.projects.id, project.id))
    .run();
  database
    .insert(tables.domains)
    .values({
      id: crypto.randomUUID(),
      projectId: project.id,
      hostname,
      httpsEnabled: true,
      createdAt: new Date().toISOString(),
    })
    .run();
  return project;
}

function setup() {
  const database = openMemoryDatabase();
  const dependencies = { database, logger: createLogger("test"), config: getConfig() };
  return { database, dependencies };
}

function answering(status: number): ProbeTools {
  return {
    lookup: async () => await Promise.resolve([PUBLIC_ADDRESS]),
    fetch: Object.assign(async () => await Promise.resolve(new Response(null, { status })), {
      preconnect: fetch.preconnect,
    }),
    now: () => 0,
  };
}

describe("listLiveDomains", () => {
  test("lists the domains of deployed projects only, with the automatic one first", () => {
    const { database } = setup();
    saveSystemSettings(database, {
      ...getSystemSettings(database),
      baseDomain: "apps.example.com",
    });
    const live = liveProject(database, "api", "api.acme.com");
    createTestProject(database, { name: "Never deployed", slug: "draft" });

    const domains = listLiveDomains(database, getSystemSettings(database));

    expect(domains.map((domain) => domain.hostname)).toEqual([
      "api.apps.example.com",
      "api.acme.com",
    ]);
    expect(domains.every((domain) => domain.projectId === live.id)).toBe(true);
  });
});

describe("checkUptime", () => {
  test("records a check of every live hostname", async () => {
    const { database, dependencies } = setup();
    const project = liveProject(database, "api", "api.acme.com");

    await checkUptime(dependencies, answering(200));

    const [summary] = listUptimeSummaries(database, project.id, new Date());
    expect(summary).toMatchObject({ hostname: "api.acme.com", status: "up" });
  });

  test("marks a hostname down after two failed checks", async () => {
    const { database, dependencies } = setup();
    const project = liveProject(database, "api", "api.acme.com");

    await checkUptime(dependencies, answering(502));
    await checkUptime(dependencies, answering(502));

    expect(listUptimeSummaries(database, project.id, new Date())[0]?.status).toBe("down");
  });
});

describe("checkCertificates", () => {
  test("never contacts a hostname recorded as private by the uptime check", async () => {
    const { database, dependencies } = setup();
    using _connection = database.$client;
    liveProject(database, "private", "internal.acme.com");
    await checkUptime(dependencies, {
      ...answering(200),
      lookup: async () => await Promise.resolve(["127.0.0.1"]),
    });
    const contacted: string[] = [];

    await checkCertificates(dependencies, async (hostname) => {
      contacted.push(hostname);
      return await Promise.resolve(null);
    });

    expect(contacted).toEqual([]);
  });

  test("stores the expiry and remembers the alert of a certificate close to expiring", async () => {
    const { database, dependencies } = setup();
    const project = liveProject(database, "api", "api.acme.com");
    await checkUptime(dependencies, answering(200));
    const expiresAt = new Date(Date.now() + 3 * DAY_IN_MS);

    await checkCertificates(dependencies, async () => await Promise.resolve(expiresAt));

    const state = database
      .select({
        expiresAt: tables.uptimeStates.certificateExpiresAt,
        alertedAt: tables.uptimeStates.certificateAlertedAt,
      })
      .from(tables.uptimeStates)
      .where(eq(tables.uptimeStates.projectId, project.id))
      .get();
    expect(state?.expiresAt).toBe(expiresAt.toISOString());
    expect(state?.alertedAt).not.toBeNull();
  });

  test("never contacts a hostname the uptime check has not found public yet", async () => {
    const { database, dependencies } = setup();
    liveProject(database, "api", "api.acme.com");
    const contacted: string[] = [];

    await checkCertificates(dependencies, async (hostname) => {
      contacted.push(hostname);
      return await Promise.resolve(null);
    });

    expect(contacted).toEqual([]);
  });
});
