import { describe, expect, test } from "bun:test";

import { openMemoryDatabase } from "@/db";
import { getDeployment, requestDeployment } from "@/deployments";
import { openPreview } from "@/previews";
import { RouteFiles } from "@/routing";
import { saveSystemSettings } from "@/settings";
import { DEFAULT_SYSTEM_SETTINGS } from "@/shared/schemas/settings.schema";
import { createTestProject, TEST_ACTOR } from "@/testing";

import { routeTrafficTo } from "./container-start";
import { DeploymentLogWriter } from "./deployment-log-writer";

const CONTAINER = "nelcota-api-0c1d2e3f4a5b";
const TRAEFIK = {
  httpEntrypoint: "web",
  httpsEntrypoint: "websecure",
  certResolver: "le",
  compress: false,
};

function setup(options: { readonly baseDomain: string | null; readonly preview: boolean }) {
  const database = openMemoryDatabase();
  saveSystemSettings(database, { ...DEFAULT_SYSTEM_SETTINGS, baseDomain: options.baseDomain });
  const project = createTestProject(database);
  const previewId = options.preview
    ? openPreview(database, {
        projectId: project.id,
        number: 12,
        branch: "feature",
        headSha: "c".repeat(40),
      })
    : null;
  const { deploymentId } = requestDeployment(database, {
    projectId: project.id,
    trigger: "manual",
    actor: TEST_ACTOR,
    triggeredByUserId: null,
    previewId,
  });
  // Records the commands instead of touching a server.
  const commands: (readonly string[])[] = [];
  const routes = new RouteFiles(async (command) => {
    commands.push(command);
    return await Promise.resolve({
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      aborted: false,
    });
  }, "/routes");
  const dependencies = { database, routes, config: { routingSettleInMs: 0, traefik: TRAEFIK } };
  const context = (logs: DeploymentLogWriter) => ({
    deployment: getDeployment(database, deploymentId),
    project,
    logs,
  });
  return { database, deploymentId, project, commands, dependencies, context };
}

/** The file name and content of the route write; the content is the last argument. */
function writtenRoutes(commands: readonly (readonly string[])[]) {
  const write = commands.at(0) ?? [];
  return { fileName: write.at(-2), content: JSON.parse(write.at(-1) ?? "null") as unknown };
}

describe("routeTrafficTo production", () => {
  test("points the project's routes at the new container alone", async () => {
    const setupResult = setup({ baseDomain: "apps.example.com", preview: false });
    const { database, deploymentId, project, commands, dependencies, context } = setupResult;
    using logs = new DeploymentLogWriter(database, deploymentId);

    await routeTrafficTo(dependencies, context(logs), CONTAINER);

    const routes = writtenRoutes(commands);
    expect(routes.fileName).toBe(`${project.id}.yml`);
    expect(routes.content).toMatchObject({
      http: {
        services: {
          "nelcota-api": { loadBalancer: { servers: [{ url: `http://${CONTAINER}:3000` }] } },
        },
      },
    });
  });

  test("removes the routes of a project without domains", async () => {
    const { database, deploymentId, project, commands, dependencies, context } = setup({
      baseDomain: null,
      preview: false,
    });
    using logs = new DeploymentLogWriter(database, deploymentId);

    await routeTrafficTo(dependencies, context(logs), CONTAINER);

    expect(commands).toEqual([["rm", "-f", "--", `/routes/${project.id}.yml`]]);
  });
});

describe("routeTrafficTo previews", () => {
  test("routes a preview at its own address, apart from production's routes", async () => {
    const { database, deploymentId, project, commands, dependencies, context } = setup({
      baseDomain: "apps.example.com",
      preview: true,
    });
    using logs = new DeploymentLogWriter(database, deploymentId);

    await routeTrafficTo(dependencies, context(logs), CONTAINER);

    const routes = writtenRoutes(commands);
    expect(routes.fileName).toBe(`${project.id}-pr-12.yml`);
    expect(routes.content).toMatchObject({
      http: {
        routers: { "nelcota-api-pr-12-0": { rule: "Host(`pr-12-api.apps.example.com`)" } },
      },
    });
  });
});
