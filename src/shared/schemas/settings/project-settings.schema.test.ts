import { expect, test } from "bun:test";

import { projectSettingsChangeSchema } from "./project-settings.schema";

test("accepts a page without requiring fields from other pages", () => {
  expect(
    projectSettingsChangeSchema.parse({
      section: "build",
      project: { dockerfilePath: "Dockerfile", buildContext: "." },
    }),
  ).toEqual({ section: "build", project: { dockerfilePath: "Dockerfile", buildContext: "." } });
});

test("strips unrelated fields so a build request cannot change identity or repository", () => {
  const parsed = projectSettingsChangeSchema.parse({
    section: "build",
    project: {
      dockerfilePath: "Dockerfile",
      buildContext: ".",
      name: "Injected",
      repositoryUrl: "https://github.com/other/repo",
      serverId: "other",
    },
  });

  expect(parsed.project).toEqual({ dockerfilePath: "Dockerfile", buildContext: "." });
});

test.each([
  null,
  {},
  { section: "unknown", project: {} },
  { section: "identity", project: { name: " ", slug: "app" } },
  { section: "build", project: { dockerfilePath: "../Dockerfile", buildContext: "." } },
  {
    section: "repository",
    project: { repositoryUrl: "https://evil.example/repo", branch: "main" },
  },
  { section: "runtime", project: { internalPort: "0", healthCheckPath: "" } },
  { section: "runtime", project: { internalPort: "65536", healthCheckPath: "" } },
  { section: "runtime", project: { internalPort: "NaN", healthCheckPath: "" } },
  { section: "runtime", project: { internalPort: Infinity, healthCheckPath: "" } },
  {
    section: "automation",
    project: { autoDeploy: "true", autoApplyChanges: true, previewsEnabled: false },
  },
])("rejects invalid page settings %p", (input) => {
  expect(projectSettingsChangeSchema.safeParse(input).success).toBe(false);
});
