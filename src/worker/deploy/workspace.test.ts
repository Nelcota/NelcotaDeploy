import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runProcess } from "@/process";

import { PathOutsideWorkspaceError, WorkspaceCommandError } from "../worker.errors";
import { DeploymentWorkspace, resolveInsideWorkspace } from "./workspace";

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "nelcota-ws-"));
  await mkdir(join(root, "apps"));
  await writeFile(join(root, "apps", "Dockerfile"), "FROM scratch\n");
  return root;
}

describe("resolveInsideWorkspace", () => {
  test("resolves a path inside the repository", async () => {
    const root = await repository();

    const path = await resolveInsideWorkspace(runProcess, root, "apps/Dockerfile");

    expect(path.endsWith("apps/Dockerfile")).toBe(true);
  });

  test("throws PathOutsideWorkspaceError for a symlink pointing outside", async () => {
    const root = await repository();
    await symlink("/etc/passwd", join(root, "Dockerfile"));

    const error = await resolveInsideWorkspace(runProcess, root, "Dockerfile").catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(PathOutsideWorkspaceError);
  });

  test("throws PathOutsideWorkspaceError for a missing file", async () => {
    const root = await repository();

    const error = await resolveInsideWorkspace(runProcess, root, "missing/Dockerfile").catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(PathOutsideWorkspaceError);
  });
});

describe("DeploymentWorkspace", () => {
  test("creates a fresh directory under the root and removes it when disposed", async () => {
    const root = await mkdtemp(join(tmpdir(), "nelcota-root-"));
    let created = "";

    {
      await using workspace = await DeploymentWorkspace.create(runProcess, root, "api");
      created = workspace.path;
      expect((await stat(created)).isDirectory()).toBe(true);
    }

    expect(created.startsWith(join(root, "api-"))).toBe(true);
    expect(await stat(created).catch(() => null)).toBeNull();
  });

  test("throws WorkspaceCommandError when the root cannot be created", async () => {
    const error = await DeploymentWorkspace.create(runProcess, "/proc/nelcota", "api").catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(WorkspaceCommandError);
  });
});
