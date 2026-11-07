import { expect, test } from "bun:test";

import { openMemoryDatabase } from "@/db";
import { projectSettingsChangeSchema } from "@/shared/schemas/settings/project-settings.schema";
import { createTestProject, TEST_ACTOR } from "@/testing";

import { updateProjectSettings } from "./project-settings.service";
import { ProjectNotFoundError, ProjectSlugTakenError } from "./project.errors";
import { getProject } from "./project.service";

const EDITOR = { actor: TEST_ACTOR, isAdmin: true };

test("saving a stale identity page preserves the latest build, repository and automation", () => {
  const database = openMemoryDatabase();
  using _database = { [Symbol.dispose]: () => database.$client.close() };
  const initial = createTestProject(database, { internalPort: null });
  updateProjectSettings(database, {
    projectId: initial.id,
    editor: EDITOR,
    change: {
      section: "build",
      project: { dockerfilePath: "deploy/Dockerfile", buildContext: "deploy" },
    },
  });
  updateProjectSettings(database, {
    projectId: initial.id,
    editor: EDITOR,
    change: {
      section: "repository",
      project: { repositoryUrl: "https://github.com/acme/other", branch: "release" },
    },
  });
  updateProjectSettings(database, {
    projectId: initial.id,
    editor: EDITOR,
    change: {
      section: "automation",
      project: { autoDeploy: false, autoApplyChanges: false, previewsEnabled: true },
    },
  });

  const saved = updateProjectSettings(database, {
    projectId: initial.id,
    editor: EDITOR,
    change: projectSettingsChangeSchema.parse({
      section: "identity",
      project: { ...initial, name: "Renamed" },
    }),
  });

  expect(saved).toMatchObject({
    name: "Renamed",
    dockerfilePath: "deploy/Dockerfile",
    buildContext: "deploy",
    branch: "release",
    repositoryFullName: "acme/other",
    autoDeploy: false,
    autoApplyChanges: false,
    previewsEnabled: true,
    internalPortAuto: true,
  });
});

test("changing runtime preserves build settings and automatic port selection", () => {
  const database = openMemoryDatabase();
  using _database = { [Symbol.dispose]: () => database.$client.close() };
  const project = createTestProject(database, { dockerfilePath: "prod/Dockerfile" });
  const change = projectSettingsChangeSchema.parse({
    section: "runtime",
    project: {
      internalPort: "",
      healthCheckPath: "/health",
      memoryLimitInMb: "128",
      cpuLimitInMillicores: "500",
    },
  });

  const saved = updateProjectSettings(database, { projectId: project.id, change, editor: EDITOR });

  expect(saved).toMatchObject({
    internalPortAuto: true,
    internalPort: project.internalPort,
    healthCheckPath: "/health",
    memoryLimitInMb: 128,
    cpuLimitInMillicores: 500,
    dockerfilePath: "prod/Dockerfile",
  });
});

test("changing repositories still requires approval for a non-admin editor", () => {
  const database = openMemoryDatabase();
  using _database = { [Symbol.dispose]: () => database.$client.close() };
  const project = createTestProject(database);

  const saved = updateProjectSettings(database, {
    projectId: project.id,
    editor: { actor: TEST_ACTOR, isAdmin: false },
    change: {
      section: "repository",
      project: { repositoryUrl: "https://github.com/acme/new", branch: "main" },
    },
  });

  expect(saved.deploymentsApproved).toBe(false);
});

test("throws ProjectNotFoundError for a missing project", () => {
  const database = openMemoryDatabase();
  using _database = { [Symbol.dispose]: () => database.$client.close() };

  expect(() =>
    updateProjectSettings(database, {
      projectId: "missing",
      editor: EDITOR,
      change: { section: "identity", project: { name: "Missing", slug: "missing" } },
    }),
  ).toThrow(ProjectNotFoundError);
});

test("throws ProjectSlugTakenError without partially saving identity", () => {
  const database = openMemoryDatabase();
  using _database = { [Symbol.dispose]: () => database.$client.close() };
  const project = createTestProject(database);
  createTestProject(database, { slug: "taken", name: "Other" });

  expect(() =>
    updateProjectSettings(database, {
      projectId: project.id,
      editor: EDITOR,
      change: { section: "identity", project: { name: "Changed", slug: "taken" } },
    }),
  ).toThrow(ProjectSlugTakenError);
  expect(getProject(database, project.id).name).toBe(project.name);
});
