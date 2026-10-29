import { afterAll, describe, expect, test } from "bun:test";

import { tables } from "@/db";
import { getDeployment } from "@/deployments";
import { getServer, LOCAL_SERVER_ID, recordServerCheck } from "@/servers";

import { type Cleanup, runCleanupsInReverse } from "./integration-fixtures/fixture-host";
import {
  createRemoteEnvironment,
  fetchThroughProxy,
  VPS_FLAVORS,
} from "./integration-fixtures/remote-environment";
import {
  createWorkerDependencies,
  deployThroughQueue,
} from "./integration-fixtures/worker-harness";
import { HostSampler } from "./servers/host-sampler";
import { checkServer } from "./servers/server-checker";
import { createLocalHost, ServerHosts } from "./servers/server-hosts";

// Boots a Docker-in-Docker "VPS", runs the real install command on it and deploys there over
// SSH, so the default `bun run test` ignores it. Run it with:
//   bun run test:docker
const CLEANUP_TIMEOUT_IN_MS = 120_000;
const TEST_TIMEOUT_IN_MS = 600_000;

async function setup(cleanups: Cleanup[], flavor: (typeof VPS_FLAVORS)[number]) {
  const environment = await createRemoteEnvironment(cleanups, flavor);
  const hosts = new ServerHosts(
    createLocalHost(environment.config, LOCAL_SERVER_ID),
    environment.privateKey,
  );
  cleanups.push(async () => {
    hosts[Symbol.dispose]();
    await Promise.resolve();
  });
  const dependencies = await createWorkerDependencies(environment.database, hosts);
  return { ...environment, hosts, dependencies };
}

describe("deploy to a server reached over SSH", () => {
  const cleanups: Cleanup[] = [];

  // Removing the VPS containers and images outlasts the default 5 s hook timeout on CI runners.
  afterAll(async () => {
    await runCleanupsInReverse(cleanups);
  }, CLEANUP_TIMEOUT_IN_MS);

  test.each(VPS_FLAVORS)(
    "sets up a fresh %s server with the install command and deploys an app on it",
    async (flavor) => {
      const environment = await setup(cleanups, flavor);
      const { vps, database, config, server, hosts } = environment;

      const check = await checkServer(config, server, hosts.hostFor(server));
      recordServerCheck(database, server.id, check);
      const deploymentId = await deployThroughQueue(
        environment.dependencies,
        environment.project.id,
      );
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
