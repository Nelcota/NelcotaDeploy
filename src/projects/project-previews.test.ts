import { expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { openMemoryDatabase, tables } from "@/db";
import { listActivePreviews, openPreview } from "@/previews";
import { projectInputSchema } from "@/shared/schemas/project.schema";
import { createTestProject, TEST_ACTOR } from "@/testing";

import { updateProject } from "./project.service";

test.each(["disable", "branch", "repository"])(
  "queues cleanup for existing previews on a project %s change",
  (change) => {
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const project = createTestProject(database, { previewsEnabled: true });
    openPreview(database, {
      projectId: project.id,
      number: 1,
      branch: "feature",
      headSha: "a".repeat(40),
    });
    const input = projectInputSchema.parse({
      ...project,
      healthCheckPath: "",
      previewsEnabled: change !== "disable",
      branch: change === "branch" ? "next" : project.branch,
      repositoryUrl:
        change === "repository" ? "https://github.com/other/code" : project.repositoryUrl,
    });

    updateProject(database, {
      projectId: project.id,
      input,
      editor: { actor: TEST_ACTOR, isAdmin: true },
    });

    expect(listActivePreviews(database, project.id)).toHaveLength(0);
    expect(
      database
        .select({ id: tables.jobs.id })
        .from(tables.jobs)
        .where(eq(tables.jobs.kind, "preview_cleanup"))
        .all(),
    ).toHaveLength(1);
  },
);
