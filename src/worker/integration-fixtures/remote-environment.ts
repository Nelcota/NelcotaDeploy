import { resolve } from "node:path";

import { eq } from "drizzle-orm";

import { getConfig } from "@/config";
import { openMemoryDatabase, tables } from "@/db";
import { addDomain } from "@/domains";
import { generateSshKeyPair } from "@/remote";
import { addServer, buildInstallCommand } from "@/servers";
import { createTestProject, TEST_ACTOR } from "@/testing";

import { copyRepositoryInto, type FakeVps, startFakeVps, type VpsFlavor } from "./fake-vps";
import { type Cleanup, createFixtureRepository } from "./fixture-host";

const FIXTURE_DIRECTORY = resolve(import.meta.dir, "../../../fixtures/hello-app");
const USERNAME = "nelcota";
/** Domain routed to the fixture app through the server's proxy. */
const REMOTE_HOSTNAME = "app.example.test";
const ROUTE_WAIT_IN_MS = 30_000;

/**
 * Distributions the end-to-end test installs on. Alpine already runs Docker; on Debian and
 * Ubuntu the install command installs it from get.docker.com, as on a fresh VPS.
 */
export const VPS_FLAVORS: VpsFlavor[] = ["alpine", "debian", "ubuntu"];
const ROUTE_POLL_INTERVAL_IN_MS = 1000;

/**
 * Fetches the fixture's health page through the server's proxy. Traefik applies new routes a
 * moment after the container starts, so it retries until the deadline.
 *
 * @param vps - Fake server.
 * @param deadline - Epoch milliseconds to give up at.
 * @returns The page body.
 */
export async function fetchThroughProxy(
  vps: FakeVps,
  deadline: number = Date.now() + ROUTE_WAIT_IN_MS,
): Promise<string> {
  try {
    // Alpine ships wget, Debian ships curl.
    return await vps.exec([
      "sh",
      "-c",
      'if command -v curl >/dev/null; then curl -fsS -H "Host: $1" "$2"; else wget -qO- --header "Host: $1" "$2"; fi',
      "sh",
      REMOTE_HOSTNAME,
      "http://127.0.0.1/health",
    ]);
  } catch (error) {
    if (Date.now() >= deadline) {
      throw error;
    }
    await Bun.sleep(ROUTE_POLL_INTERVAL_IN_MS);
    return await fetchThroughProxy(vps, deadline);
  }
}

// Requests the fixture through the proxy until /tmp/stop-traffic exists. Prints how many it
// sent, then the error of each failed one. Alpine ships wget, Debian ships curl.
const TRAFFIC_LOOP = `
requests=0; : > /tmp/traffic-errors
while [ ! -f /tmp/stop-traffic ]; do
  if command -v curl >/dev/null; then
    curl -fsS -o /dev/null -H "Host: $1" "$2" 2>>/tmp/traffic-errors
  else
    wget -q -O /dev/null --header "Host: $1" "$2" 2>>/tmp/traffic-errors
  fi
  requests=$((requests + 1))
done
echo "$requests"
cat /tmp/traffic-errors`;

/**
 * Sends requests to the fixture through the proxy, without pause, while `during` runs.
 *
 * @param vps - Fake server.
 * @param during - Work to measure, such as a deployment that replaces the container.
 * @returns How many requests were sent and the error of each one that failed.
 */
export async function trafficDuring(
  vps: FakeVps,
  during: () => Promise<unknown>,
): Promise<{ requests: number; errors: string[] }> {
  await vps.exec(["rm", "-f", "/tmp/stop-traffic"]);
  const loop = vps.exec(["sh", "-c", TRAFFIC_LOOP, "sh", REMOTE_HOSTNAME, "http://127.0.0.1/"]);
  try {
    await during();
  } finally {
    await vps.exec(["touch", "/tmp/stop-traffic"]);
  }
  const [count = "", ...errors] = (await loop).trim().split("\n");
  return { requests: Number(count), errors: errors.filter((line) => line.trim() !== "") };
}

/**
 * Boots a fake VPS, runs the panel's install command on it and prepares a project placed
 * there, with the fixture repository cloned from inside the server and an HTTP-only domain.
 *
 * @param cleanups - Receives everything to undo after the test.
 * @param flavor - Distribution of the fake VPS.
 * @returns Server, the output of the install command, database, configuration, project and
 *   the panel key.
 */
export async function createRemoteEnvironment(cleanups: Cleanup[], flavor: VpsFlavor) {
  const keys = generateSshKeyPair();
  const vps = await startFakeVps(cleanups, flavor);
  const installCommand = buildInstallCommand(keys.publicKey, USERNAME);
  const installOutput = await vps.exec([vps.rootShell], installCommand);
  await vps.startDocker();
  const repository = await createFixtureRepository(FIXTURE_DIRECTORY, cleanups);
  const remoteRepository = await copyRepositoryInto(vps, repository, USERNAME);
  const database = openMemoryDatabase();
  const server = addServer(database, {
    input: { name: "vps", host: "127.0.0.1", port: vps.sshPort, username: USERNAME },
    actor: TEST_ACTOR,
  });
  const project = createTestProject(database, {
    slug: "remote-it",
    // Automatic: the build reads 8000 from the fixture's EXPOSE, over SSH.
    internalPort: null,
    healthCheckPath: "/health",
  });
  database
    .update(tables.projects)
    .set({ repositoryUrl: `file://${remoteRepository}`, serverId: server.id })
    .where(eq(tables.projects.id, project.id))
    .run();
  addDomain(database, {
    projectId: project.id,
    input: { hostname: REMOTE_HOSTNAME, httpsEnabled: false },
    actor: TEST_ACTOR,
  });
  return {
    vps,
    installOutput,
    database,
    config: getConfig(),
    server,
    project,
    privateKey: keys.privateKey,
  };
}
