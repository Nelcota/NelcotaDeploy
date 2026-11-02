import { expect, spyOn, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";

import { eq } from "drizzle-orm";

import { openMemoryDatabase, tables } from "@/db";
import {
  completeDeployment,
  getDeployment,
  hasPendingRuntimeChanges,
  requestDeployment,
  transitionDeployment,
} from "@/deployments";
import { imageTagFor } from "@/docker";
import { resolveEnvironment, saveEnvironmentVariable } from "@/environments";
import { saveGitHubApp } from "@/github";
import { JobLeaseLostError } from "@/jobs";
import type { CommandRunner } from "@/process";
import { getProject, updateProject } from "@/projects";
import { projectInputSchema } from "@/shared/schemas/project.schema";
import { createTestProject, createTestSecretBox, FakeDocker, TEST_ACTOR } from "@/testing";

import { runDeployment } from "./deploy-runner";

const runner: CommandRunner = async (command) => {
  let stdout = "";
  if (command[0] === "mktemp") {
    stdout = "/review/workspace\n";
  }
  if (command[0] === "sh") {
    const root = command.at(-2);
    const path = command.at(-1);
    if (root == null || path == null) {
      throw new Error("Missing workspace arguments in test runner");
    }
    stdout = `${root}\n${path}\n`;
  }
  return await Promise.resolve({
    exitCode: 0,
    stdout,
    stderr: "",
    timedOut: false,
    aborted: false,
  });
};

async function setup() {
  const database = openMemoryDatabase();
  const project = createTestProject(database);
  const docker = new FakeDocker();
  const dependencies = {
    database,
    docker,
    runner,
    secretBox: await createTestSecretBox(),
    git: {
      checkoutRevision: async () => await Promise.resolve({ sha: "a".repeat(40), message: "test" }),
    },
    routes: null,
    probes: {
      tcp: async () => await Promise.resolve(true),
      http: async () => await Promise.resolve(true),
    },
    config: {
      workspaceDir: "/review",
      network: "review",
      buildTimeoutInSeconds: 60,
      healthCheckTimeoutInSeconds: 5,
      imagesKeptPerProject: 5,
      routingSettleInMs: 0,
      traefik: {
        httpEntrypoint: "web",
        httpsEntrypoint: "websecure",
        certResolver: "le",
        compress: false,
      },
    },
  } satisfies Parameters<typeof runDeployment>[0];
  const deploymentId = requestDeployment(database, {
    projectId: project.id,
    trigger: "manual",
    actor: TEST_ACTOR,
    triggeredByUserId: null,
  }).deploymentId;
  return { database, project, dependencies, docker, deploymentId };
}

test("a lost lease never marks the replacement deployment failed or cleans its container", async () => {
  const { database, deploymentId, dependencies, docker } = await setup();
  let checks = 0;
  const failure = await runDeployment(
    {
      ...dependencies,
      assertOwnership: () => {
        checks += 1;
        if (checks > 1) {
          throw new JobLeaseLostError("claimed-job");
        }
      },
    },
    deploymentId,
    new AbortController().signal,
  ).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(JobLeaseLostError);
  expect(getDeployment(database, deploymentId).status).not.toBe("failed");
  expect(docker.calls.some((call) => call.startsWith("rm "))).toBe(false);
});

test("losing ownership during network setup never removes or starts a container", async () => {
  const { database, dependencies, docker, deploymentId } = await setup();
  using _connection = database.$client;
  let owned = true;
  docker.ensureNetwork = () => {
    owned = false;
    return Promise.resolve();
  };

  const failure = await runDeployment(
    {
      ...dependencies,
      assertOwnership: () => {
        if (owned === false) {
          throw new JobLeaseLostError("previous-attempt");
        }
      },
    },
    deploymentId,
    new AbortController().signal,
  ).catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(JobLeaseLostError);
  expect(docker.calls.some((call) => call.startsWith("run ") || call.startsWith("rm "))).toBe(
    false,
  );
});

test("a replacement attempt gets its own container and retires the abandoned attempt", async () => {
  const { database, dependencies, docker, deploymentId } = await setup();
  using _connection = database.$client;
  let owned = true;
  const run = docker.runContainer.bind(docker);
  docker.runContainer = async (options, values) => {
    const id = await run(options, values);
    owned = false;
    return id;
  };
  const failure = await runDeployment(
    {
      ...dependencies,
      assertOwnership: () => {
        if (owned === false) {
          throw new JobLeaseLostError("previous-attempt");
        }
      },
    },
    deploymentId,
    new AbortController().signal,
  ).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(JobLeaseLostError);
  const abandoned = getDeployment(database, deploymentId).containerName;
  transitionDeployment(database, deploymentId, { to: "queued" });
  docker.runContainer = run;

  expect(await runDeployment(dependencies, deploymentId, new AbortController().signal)).toBe(
    "succeeded",
  );

  const current = getDeployment(database, deploymentId).containerName;
  expect(current).not.toBe(abandoned);
  expect([...docker.containers.keys()]).toEqual([current ?? ""]);
}, 10_000);

test("sends saved CPU and memory limits to the application container", async () => {
  const { database, project, dependencies, docker, deploymentId } = await setup();
  using _connection = database.$client;
  database
    .update(tables.projects)
    .set({ memoryLimitInMb: 128, cpuLimitInMillicores: 250 })
    .where(eq(tables.projects.id, project.id))
    .run();

  expect(await runDeployment(dependencies, deploymentId, new AbortController().signal)).toBe(
    "succeeded",
  );

  const definition = docker.definitions.get(
    getDeployment(database, deploymentId).containerName ?? "",
  );
  expect(definition?.memoryLimitInMb).toBe(128);
  expect(definition?.cpuLimitInMillicores).toBe(250);
}, 10_000);

test("obtains a GitHub App token when a redeploy must rebuild its missing private image", async () => {
  const { database, project, dependencies, deploymentId } = await setup();
  using _connection = database.$client;
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  await saveGitHubApp(database, dependencies.secretBox, {
    actor: TEST_ACTOR,
    app: {
      id: 985,
      slug: "test",
      name: "test",
      html_url: "https://github.com/apps/test",
      owner: { login: "acme" },
      pem: privateKey,
      webhook_secret: null,
      client_id: "test",
      client_secret: "test",
    },
  });
  transitionDeployment(database, deploymentId, {
    to: "starting",
    imageTag: imageTagFor(project.slug, deploymentId),
    commitSha: "a".repeat(40),
    internalPort: 3000,
  });
  transitionDeployment(database, deploymentId, { to: "health_checking" });
  completeDeployment(database, deploymentId);
  const next = requestDeployment(database, {
    projectId: project.id,
    trigger: "redeploy",
    actor: TEST_ACTOR,
    triggeredByUserId: null,
    sourceDeploymentId: deploymentId,
  });
  const fetchMock = spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json({ id: 985 }))
    .mockResolvedValueOnce(
      Response.json({ token: "installation-test-token", expires_at: "2099-01-01T00:00:00Z" }),
    );
  using _fetch = { [Symbol.dispose]: () => fetchMock.mockRestore() };
  const received = { token: null as string | null };

  const status = await runDeployment(
    {
      ...dependencies,
      git: {
        checkoutRevision: (options) => {
          received.token = options.token;
          return Promise.resolve({ sha: "a".repeat(40), message: "private" });
        },
      },
    },
    next.deploymentId,
    new AbortController().signal,
  );

  expect(status).toBe("succeeded");
  expect(received.token).toBe("installation-test-token");
  expect(fetchMock).toHaveBeenCalledTimes(2);
}, 10_000);

test.each([false, true])(
  "refuses queued code after its repository changed, including reapproval=%p",
  async (isAdmin) => {
    const { database, project, dependencies, deploymentId, docker } = await setup();
    using _connection = database.$client;
    updateProject(database, {
      projectId: project.id,
      input: projectInputSchema.parse({
        ...project,
        healthCheckPath: "",
        repositoryUrl: "https://github.com/other/code",
      }),
      editor: { actor: TEST_ACTOR, isAdmin },
    });
    let cloned = false;

    const status = await runDeployment(
      {
        ...dependencies,
        git: {
          checkoutRevision: async () => {
            cloned = true;
            await Promise.resolve();
            throw new Error("Must not clone unapproved code");
          },
        },
      },
      deploymentId,
      new AbortController().signal,
    );

    expect(status).toBe("failed");
    expect(cloned).toBe(false);
    expect(docker.containers.size).toBe(0);
  },
);

test("keeps the committed live container when retiring previous containers fails", async () => {
  const { database, project, dependencies, deploymentId, docker } = await setup();
  using _connection = database.$client;
  docker.listManagedContainers = async () => {
    await Promise.resolve();
    throw new Error("Docker API interrupted");
  };

  const status = await runDeployment(dependencies, deploymentId, new AbortController().signal);

  expect(status).toBe("succeeded");
  expect(getProject(database, project.id).currentDeploymentId).toBe(deploymentId);
  expect(docker.containers.size).toBe(1);
}, 10_000);

test("uses the source deployment's recorded port for an image rollback", async () => {
  const { database, project, dependencies, deploymentId, docker } = await setup();
  using _connection = database.$client;
  const imageTag = imageTagFor(project.slug, deploymentId);
  transitionDeployment(database, deploymentId, { to: "starting", imageTag, internalPort: 3000 });
  transitionDeployment(database, deploymentId, { to: "health_checking" });
  completeDeployment(database, deploymentId);
  docker.images.tags.add(imageTag);
  database
    .update(tables.projects)
    .set({ internalPort: 8080 })
    .where(eq(tables.projects.id, project.id))
    .run();
  const rollback = requestDeployment(database, {
    projectId: project.id,
    trigger: "rollback",
    sourceDeploymentId: deploymentId,
    actor: TEST_ACTOR,
    triggeredByUserId: null,
  });
  const ports = new Set<number>();

  const status = await runDeployment(
    {
      ...dependencies,
      probes: {
        ...dependencies.probes,
        tcp: async (_host, port) => {
          ports.add(port);
          return await Promise.resolve(port === 3000);
        },
      },
    },
    rollback.deploymentId,
    new AbortController().signal,
  );

  expect(status).toBe("succeeded");
  expect(ports).toEqual(new Set([3000]));
  expect(getDeployment(database, rollback.deploymentId).internalPort).toBe(3000);
}, 10_000);

test("requeues a shutdown-interrupted deployment and allows it to finish on retry", async () => {
  const { database, dependencies, deploymentId } = await setup();
  using _connection = database.$client;
  const controller = new AbortController();
  const interrupted = {
    ...dependencies,
    git: {
      checkoutRevision: async () => {
        controller.abort();
        await Promise.resolve();
        throw new Error("Clone interrupted");
      },
    },
  };

  const error = await runDeployment(interrupted, deploymentId, controller.signal).catch(
    (failure: unknown) => failure,
  );
  expect(error).toMatchObject({ message: "Clone interrupted" });

  expect(getDeployment(database, deploymentId).status).toBe("queued");
  expect(await runDeployment(dependencies, deploymentId, new AbortController().signal)).toBe(
    "succeeded",
  );
}, 10_000);

test("refuses to guess a legacy rollback's port from changed project settings", async () => {
  const { database, project, dependencies, deploymentId, docker } = await setup();
  using _connection = database.$client;
  const imageTag = imageTagFor(project.slug, deploymentId);
  transitionDeployment(database, deploymentId, { to: "starting", imageTag });
  transitionDeployment(database, deploymentId, { to: "health_checking" });
  completeDeployment(database, deploymentId);
  docker.images.tags.add(imageTag);
  const rollback = requestDeployment(database, {
    projectId: project.id,
    trigger: "rollback",
    sourceDeploymentId: deploymentId,
    actor: TEST_ACTOR,
    triggeredByUserId: null,
  });

  const outcome = await runDeployment(
    dependencies,
    rollback.deploymentId,
    new AbortController().signal,
  );

  expect(outcome).toBe("failed");
  expect(getDeployment(database, rollback.deploymentId).errorMessage).toContain(
    "recorded container port",
  );
  expect(getProject(database, project.id).currentDeploymentId).toBe(deploymentId);
  expect(docker.containers.size).toBe(0);
});

test("keeps a concurrent variable edit pending until its value reaches a new container", async () => {
  const { database, project, dependencies, deploymentId, docker } = await setup();
  using _connection = database.$client;
  const input = {
    key: "CONFIG_VALUE",
    kind: "plain" as const,
    value: "old",
    availableAtBuild: false,
    excludeFromPreviews: false,
  };
  await saveEnvironmentVariable(database, dependencies.secretBox, {
    projectId: project.id,
    input,
    actor: TEST_ACTOR,
  });

  const outcome = runDeployment(dependencies, deploymentId, new AbortController().signal);
  await saveEnvironmentVariable(database, dependencies.secretBox, {
    projectId: project.id,
    input: { ...input, value: "new" },
    actor: TEST_ACTOR,
  });
  expect(await outcome).toBe("succeeded");

  expect([...docker.environments.values()].at(0)?.["CONFIG_VALUE"]).toBe("old");
  expect(
    (await resolveEnvironment(database, dependencies.secretBox, { projectId: project.id })).runtime[
      "CONFIG_VALUE"
    ],
  ).toBe("new");
  expect(hasPendingRuntimeChanges(database, project.id)).toBe(true);
}, 10_000);
