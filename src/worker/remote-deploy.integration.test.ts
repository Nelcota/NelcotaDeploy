import { afterAll, describe, expect, test } from "bun:test";

import { getConfig } from "@/config";
import { tables } from "@/db";
import { getDeployment, requestDeployment } from "@/deployments";
import { claimNextJob } from "@/jobs";
import { createLogger } from "@/logging";
import { getServer, LOCAL_SERVER_ID, recordServerCheck } from "@/servers";
import { createTestSecretBox, TEST_ACTOR } from "@/testing";

import { type Cleanup, runCleanupsInReverse } from "./integration-fixtures/fixture-host";
import {
  createRemoteEnvironment,
  fetchThroughProxy,
} from "./integration-fixtures/remote-environment";
import { dispatchJob } from "./job-dispatch";
import { HostSampler } from "./servers/host-sampler";
import { checkServer } from "./servers/server-checker";
import { createLocalHost, ServerHosts } from "./servers/server-hosts";

// Boots a Docker-in-Docker "VPS", runs the real install command on it and deploys there over
// SSH, so the default `bun run test` ignores it. Run it with:
//   bun run test:docker
const TEST_TIMEOUT_IN_MS = 600_000;

async function setup(cleanups: Cleanup[]) {
  const environment = await createRemoteEnvironment(cleanups);
  const config = getConfig();
  const hosts = new ServerHosts(createLocalHost(config, LOCAL_SERVER_ID), environment.privateKey);
  cleanups.push(async () => {
    hosts[Symbol.dispose]();
    await Promise.resolve();
  });
  const dependencies = {
    workerId: "it",
    database: environment.database,
    hosts,
    secretBox: await createTestSecretBox(),
    config,
    logger: createLogger("remote-it"),
  };
  return { ...environment, config, hosts, dependencies };
}

/** Queues a deployment and runs its job like the worker does. */
async function deployThroughQueue(environment: Awaited<ReturnType<typeof setup>>): Promise<string> {
  const { database, project, dependencies } = environment;
  const { deploymentId } = requestDeployment(database, {
    projectId: project.id,
    trigger: "manual",
    actor: TEST_ACTOR,
    triggeredByUserId: null,
  });
  const job = claimNextJob(database, "it");
  if (job == null) {
    throw new Error("The deploy job was not queued");
  }
  await dispatchJob(dependencies, job, {
    signal: new AbortController().signal,
    refreshContainers: async () => await Promise.resolve(),
  });
  return deploymentId;
}

describe("deploy to a server reached over SSH", () => {
  const cleanups: Cleanup[] = [];

  afterAll(async () => {
    await runCleanupsInReverse(cleanups);
  });

  test(
    "sets up a fresh server with the install command and deploys an app on it",
    async () => {
      const environment = await setup(cleanups);
      const { vps, database, config, server, hosts } = environment;

      const check = await checkServer(config, server, hosts.hostFor(server));
      recordServerCheck(database, server.id, check);
      const deploymentId = await deployThroughQueue(environment);
      const sampler = new HostSampler(server.id);
      await sampler.sample(database, { runner: hosts.hostFor(server).runner, diskPath: "/" });
      const routed = await fetchThroughProxy(vps);

      expect(environment.installOutput).toContain("Servidor pronto");
      expect(check.status).toBe("ready");
      expect(getServer(database, server.id).hostKeyFingerprint).toStartWith("SHA256:");
      const deployment = getDeployment(database, deploymentId);
      expect(deployment.errorMessage).toBeNull();
      expect(deployment.status).toBe("succeeded");
      expect(deployment.serverId).toBe(server.id);
      expect(routed.trim()).toBe("ok");
      const samples = database.select().from(tables.metricSamples).all();
      expect(
        samples.some((sample) => sample.serverId === server.id && sample.memoryTotalBytes != null),
      ).toBe(true);
    },
    TEST_TIMEOUT_IN_MS,
  );
});
