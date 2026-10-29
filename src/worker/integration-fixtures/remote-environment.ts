import { resolve } from "node:path";

import { eq } from "drizzle-orm";

import { openMemoryDatabase, tables } from "@/db";
import { addDomain } from "@/domains";
import { generateSshKeyPair } from "@/remote";
import { addServer, buildInstallCommand } from "@/servers";
import { createTestProject, TEST_ACTOR } from "@/testing";

import { copyRepositoryInto, type FakeVps, startFakeVps } from "./fake-vps";
import { type Cleanup, createFixtureRepository } from "./fixture-host";

const FIXTURE_DIRECTORY = resolve(import.meta.dir, "../../../fixtures/hello-app");
const FIXTURE_PORT = 8000;
const USERNAME = "nelcota";
/** Domain routed to the fixture app through the server's proxy. */
const REMOTE_HOSTNAME = "app.example.test";
const ROUTE_WAIT_IN_MS = 30_000;
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
    return await vps.exec([
      "wget",
      "-qO-",
      "--header",
      `Host: ${REMOTE_HOSTNAME}`,
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

/**
 * Boots a fake VPS, runs the panel's install command on it and prepares a project placed
 * there, with the fixture repository cloned from inside the server and an HTTP-only domain.
 *
 * @param cleanups - Receives everything to undo after the test.
 * @returns Server, the output of the install command, database, project and the panel key.
 */
export async function createRemoteEnvironment(cleanups: Cleanup[]) {
  const keys = generateSshKeyPair();
  const vps = await startFakeVps(cleanups);
  const installOutput = await vps.exec(["sh"], buildInstallCommand(keys.publicKey, USERNAME));
  const repository = await createFixtureRepository(FIXTURE_DIRECTORY, cleanups);
  const remoteRepository = await copyRepositoryInto(vps, repository, USERNAME);
  const database = openMemoryDatabase();
  const server = addServer(database, {
    input: { name: "vps", host: "127.0.0.1", port: vps.sshPort, username: USERNAME },
    actor: TEST_ACTOR,
  });
  const project = createTestProject(database, {
    slug: "remote-it",
    internalPort: FIXTURE_PORT,
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
  return { vps, installOutput, database, server, project, privateKey: keys.privateKey };
}
