import { expect, test } from "bun:test";

import { getConfig } from "@/config";
import { openMemoryDatabase } from "@/db";
import { projectNetworkName } from "@/docker";
import { createTestProject, FakeDocker } from "@/testing";

import { prepareProjectNetwork } from "./project-network";

test("leaves a project on the legacy bridge until it is selected", async () => {
  const database = openMemoryDatabase();
  using _connection = database.$client;
  const project = createTestProject(database);
  const docker = new FakeDocker();
  const config = { ...getConfig(), DOCKER_NETWORK: "legacy", ISOLATED_PROJECT_IDS: [] };

  const network = await prepareProjectNetwork(
    { config, database, host: { docker, platformProxy: false } },
    project.id,
    () => undefined,
  );

  expect(network).toBe("legacy");
  expect(docker.calls).toEqual([]);
});

test("connects local ingress and the worker to a selected project's bridge", async () => {
  const database = openMemoryDatabase();
  using _connection = database.$client;
  const project = createTestProject(database);
  const docker = new FakeDocker();
  const config = {
    ...getConfig(),
    ISOLATED_PROJECT_IDS: [project.id],
    TRAEFIK_ENABLED: true,
    WORKER_DOCKER_CONTAINER: "nelcota-worker" as const,
  };

  const network = await prepareProjectNetwork(
    { config, database, host: { docker, platformProxy: false } },
    project.id,
    () => undefined,
  );

  expect(network).toBe(projectNetworkName(project.id));
  expect(docker.calls).toEqual([
    `ensure project network ${project.id}`,
    `attach project network ${project.id} nelcota-ingress`,
    `attach project network ${project.id} nelcota-worker`,
  ]);
});
