import { resolve } from "node:path";

import { eq } from "drizzle-orm";

import { openMemoryDatabase, tables } from "@/db";
import { DockerCli } from "@/docker";
import { GitClient } from "@/git";
import { runProcess } from "@/process";
import { createTestProject, createTestSecretBox, TEST_ACTOR } from "@/testing";

import { runProjectCleanup } from "../container-action-runner";
import {
  type Cleanup,
  createFixtureRepository,
  createTemporaryDirectory,
  removeDockerNetwork,
} from "./fixture-host";

const FIXTURE_DIRECTORY = resolve(import.meta.dir, "../../../fixtures/hello-app");
/** Port the fixture app listens on inside its container. */
export const FIXTURE_PORT = 8000;
const BUILD_TIMEOUT_IN_SECONDS = 600;
const HEALTH_CHECK_TIMEOUT_IN_SECONDS = 60;
const IMAGES_KEPT_PER_PROJECT = 5;
/** Base-36 keeps the unique slug suffix short. */
const SLUG_SUFFIX_RADIX = 36;

/**
 * Prepares a project pointing at a local copy of the fixture app, plus the dependencies the
 * deploy runner needs to build and run it with the real Docker and git.
 *
 * @param network - Docker network created for this test run.
 * @param cleanups - Receives everything to undo after the test.
 * @returns Database, Docker, encryption, project, acting user and deploy runner dependencies.
 */
export async function createFixtureEnvironment(network: string, cleanups: Cleanup[]) {
  const repository = await createFixtureRepository(FIXTURE_DIRECTORY, cleanups);
  const database = openMemoryDatabase();
  const docker = new DockerCli("docker");
  const secretBox = await createTestSecretBox();
  const project = createTestProject(database, {
    slug: `it-${Date.now().toString(SLUG_SUFFIX_RADIX)}`,
    internalPort: FIXTURE_PORT,
    healthCheckPath: "/health",
  });
  // Project validation only accepts remote URLs; the test clones a local repository.
  database
    .update(tables.projects)
    .set({ repositoryUrl: `file://${repository}` })
    .where(eq(tables.projects.id, project.id))
    .run();
  cleanups.push(async () => {
    await runProjectCleanup(database, [{ docker, routes: null }], project.id);
    await removeDockerNetwork(network);
  });
  const workspaceDir = await createTemporaryDirectory("nelcota-workspaces-", cleanups);
  const dependencies = {
    database,
    runner: runProcess,
    docker,
    git: new GitClient("git"),
    secretBox,
    config: {
      workspaceDir,
      network,
      buildTimeoutInSeconds: BUILD_TIMEOUT_IN_SECONDS,
      healthCheckTimeoutInSeconds: HEALTH_CHECK_TIMEOUT_IN_SECONDS,
      imagesKeptPerProject: IMAGES_KEPT_PER_PROJECT,
      routingSettleInMs: 0,
      traefik: {
        httpEntrypoint: "web",
        httpsEntrypoint: "websecure",
        certResolver: "le",
        compress: false,
      },
    },
    // No proxy runs in this test; the container is health checked directly.
    routes: null,
  };
  return { database, docker, secretBox, project, actor: TEST_ACTOR, dependencies };
}
