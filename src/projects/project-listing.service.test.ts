import { describe, expect, test } from "bun:test";

import { openMemoryDatabase } from "@/db";
import { createTestProject } from "@/testing";

import { listProjects } from "./project-listing.service";

describe("listProjects", () => {
  test("returns an empty list when there are no projects", () => {
    const database = openMemoryDatabase();

    const projects = listProjects(database);

    expect(projects).toEqual([]);
  });

  test("sorts projects by name", () => {
    const database = openMemoryDatabase();
    createTestProject(database, { name: "Web", slug: "web" });
    createTestProject(database, { name: "API", slug: "api" });

    const projects = listProjects(database);

    expect(projects.map((project) => project.slug)).toEqual(["api", "web"]);
  });
});

describe("listProjects search", () => {
  test("filters by name, slug or repository", () => {
    const database = openMemoryDatabase();
    createTestProject(database, { name: "API", slug: "api" });
    createTestProject(database, {
      name: "Web",
      slug: "web",
      repositoryUrl: "https://github.com/acme/storefront",
    });

    const projects = listProjects(database, { search: "storefront" });

    expect(projects.map((project) => project.slug)).toEqual(["web"]);
  });

  test("treats LIKE wildcards in the search as literal characters", () => {
    const database = openMemoryDatabase();
    createTestProject(database);

    const projects = listProjects(database, { search: "%" });

    expect(projects).toEqual([]);
  });

  test("ignores a search made only of spaces", () => {
    const database = openMemoryDatabase();
    createTestProject(database);

    const projects = listProjects(database, { search: "   " });

    expect(projects).toHaveLength(1);
  });

  test("reports no deployment or container for a new project", () => {
    const database = openMemoryDatabase();
    createTestProject(database);

    const [project] = listProjects(database);

    expect(project?.latestDeployment).toBeNull();
    expect(project?.containerState).toBeNull();
  });
});
