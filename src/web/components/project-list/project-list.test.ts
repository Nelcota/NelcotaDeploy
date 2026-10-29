import { describe, expect, test } from "bun:test";

import { isSortOption, isStatusFilter, SORT_OPTIONS, sortProjects } from "./project-list";

const PROJECTS = [
  { name: "Beta", latestDeployment: { createdAt: "2026-10-01T00:00:00Z" } },
  { name: "alfa", latestDeployment: null },
  { name: "Gama", latestDeployment: { createdAt: "2026-10-20T00:00:00Z" } },
];

describe("sortProjects", () => {
  test("orders by name ignoring case", () => {
    const sorted = sortProjects(PROJECTS, SORT_OPTIONS["name-ascending"]);

    expect(sorted.map((project) => project.name)).toEqual(["alfa", "Beta", "Gama"]);
  });

  test("orders by newest deploy and keeps never-deployed projects last", () => {
    const sorted = sortProjects(PROJECTS, SORT_OPTIONS["latestDeployment-descending"]);

    expect(sorted.map((project) => project.name)).toEqual(["Gama", "Beta", "alfa"]);
  });

  test("keeps never-deployed projects last when ordering by oldest deploy", () => {
    const sorted = sortProjects(PROJECTS, SORT_OPTIONS["latestDeployment-ascending"]);

    expect(sorted.map((project) => project.name)).toEqual(["Beta", "Gama", "alfa"]);
  });

  test("does not change the array it receives", () => {
    const projects = [...PROJECTS];

    sortProjects(projects, SORT_OPTIONS["name-descending"]);

    expect(projects).toEqual(PROJECTS);
  });
});

describe("select value guards", () => {
  test("accepts a known status filter", () => {
    const known = isStatusFilter("online");

    expect(known).toBe(true);
  });

  test("rejects an unknown status filter", () => {
    const known = isStatusFilter("__proto__");

    expect(known).toBe(false);
  });

  test("rejects an unknown sort option", () => {
    const known = isSortOption("size-ascending");

    expect(known).toBe(false);
  });
});
