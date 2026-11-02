import { expect, test } from "bun:test";

import { asc } from "drizzle-orm";

import { createTestProject } from "@/testing";

import { openMemoryDatabase } from "./database";
import * as tables from "./schema";

const CREATED_AT = new Date("2026-11-02T12:00:00.000Z");
const MIGRATION = new URL("../../drizzle/0020_project_members.sql", import.meta.url);

/** The statement that keeps the access users had before memberships existed. */
async function readBackfill(): Promise<string> {
  const statements = (await Bun.file(MIGRATION).text()).split("--> statement-breakpoint");
  const backfill = statements.at(-1);
  if (backfill == null || backfill.includes("INSERT INTO `project_members`") === false) {
    throw new Error("The project members migration has no backfill statement");
  }
  return backfill;
}

test("gives existing non-admin users their global role on every production project", async () => {
  const database = openMemoryDatabase();
  const production = createTestProject(database);
  createTestProject(database, { name: "Staging", slug: "staging" });
  database.$client.run("UPDATE projects SET parent_project_id = ? WHERE slug = 'staging'", [
    production.id,
  ]);
  for (const [id, role] of [
    ["admin", "admin"],
    ["dev", "developer"],
    ["view", "viewer"],
  ] as const) {
    database
      .insert(tables.users)
      .values({
        id,
        name: id,
        email: `${id}@example.com`,
        role,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      })
      .run();
  }

  database.$client.run(await readBackfill());

  const members = database
    .select({
      projectId: tables.projectMembers.projectId,
      userId: tables.projectMembers.userId,
      role: tables.projectMembers.role,
    })
    .from(tables.projectMembers)
    .orderBy(asc(tables.projectMembers.userId))
    .all();
  expect(members).toEqual([
    { projectId: production.id, userId: "dev", role: "developer" },
    { projectId: production.id, userId: "view", role: "viewer" },
  ]);
});
