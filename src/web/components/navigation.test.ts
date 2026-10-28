import { describe, expect, test } from "bun:test";

import { breadcrumbTrail, projectIdFromPath } from "./navigation";

function labels(pathname: string, projectName: string | null = null): string[] {
  return breadcrumbTrail(pathname, projectName).map((crumb) => crumb.label);
}

describe("breadcrumbTrail", () => {
  test("shows only the dashboard on the home page", () => {
    const trail = breadcrumbTrail("/", null);

    expect(trail).toEqual([{ label: "Painel" }]);
  });

  test("names a main area after the dashboard", () => {
    const result = labels("/deployments");

    expect(result).toEqual(["Painel", "Deploys"]);
  });

  test("names the projects list", () => {
    const result = labels("/projects");

    expect(result).toEqual(["Painel", "Projetos"]);
  });

  test("names the new project page", () => {
    const result = labels("/projects/new");

    expect(result).toEqual(["Painel", "Projetos", "Novo projeto"]);
  });

  test("uses the project name on a project page", () => {
    const result = labels("/projects/abc", "Loja");

    expect(result).toEqual(["Painel", "Projetos", "Loja"]);
  });

  test("uses a placeholder while the project name loads", () => {
    const result = labels("/projects/abc");

    expect(result).toEqual(["Painel", "Projetos", "Projeto"]);
  });

  test("adds the section of a project page", () => {
    const result = labels("/projects/abc/environment", "Loja");

    expect(result).toEqual(["Painel", "Projetos", "Loja", "Variáveis"]);
  });

  test("links the project and the deploy list on a deployment page", () => {
    const trail = breadcrumbTrail("/projects/abc/deployments/d1", "Loja");

    expect(trail.at(-2)).toEqual({
      label: "Deploys",
      link: { to: "/projects/$projectId/deployments", params: { projectId: "abc" } },
    });
  });

  test("leaves the last crumb without a link", () => {
    const trail = breadcrumbTrail("/projects/abc/logs", "Loja");

    expect(trail.at(-1)).toEqual({ label: "Logs" });
  });

  test("ignores a trailing slash", () => {
    const result = labels("/settings/");

    expect(result).toEqual(["Painel", "Administração"]);
  });
});

describe("projectIdFromPath", () => {
  test("returns the id on a project page", () => {
    const projectId = projectIdFromPath("/projects/abc/logs");

    expect(projectId).toBe("abc");
  });

  test("returns null on the new project page", () => {
    const projectId = projectIdFromPath("/projects/new");

    expect(projectId).toBeNull();
  });

  test("returns null outside project pages", () => {
    const projectId = projectIdFromPath("/deployments");

    expect(projectId).toBeNull();
  });
});
