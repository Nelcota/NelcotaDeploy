import { expect, test } from "bun:test";

import { openMemoryDatabase, tables } from "@/db";
import { createTestProject } from "@/testing";

import { summarizePreviews } from "./preview-summary";
import { openPreview } from "./preview.service";

test("selects only the latest deployment per preview using the id tie-break and keeps empty previews", () => {
  const database = openMemoryDatabase();
  using _connection = database.$client;
  const project = createTestProject(database);
  const create = (number: number) =>
    openPreview(database, {
      projectId: project.id,
      number,
      branch: `pr-${number}`,
      headSha: "a".repeat(40),
    });
  const previewId = create(1);
  const emptyId = create(2);
  database
    .insert(tables.deployments)
    .values(
      Array.from({ length: 1000 }, (_, index) => ({
        id: `deployment-${String(index).padStart(4, "0")}`,
        projectId: project.id,
        previewId,
        status: "succeeded" as const,
        trigger: "manual" as const,
        triggeredByLabel: "test",
        branch: "pr-1",
        createdAt: "2026-11-06T12:00:00.000Z",
      })),
    )
    .run();
  const summaries = summarizePreviews(database, project, {
    baseDomain: "example.com",
    httpsByDefault: true,
  });
  expect(summaries).toHaveLength(2);
  expect(summaries.find((preview) => preview.id === previewId)?.latestDeployment).toEqual({
    id: "deployment-0999",
    status: "succeeded",
  });
  expect(summaries.find((preview) => preview.id === emptyId)?.latestDeployment).toBeNull();
});
