import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type CommandRunner, runProcess } from "@/process";

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
      await using workspace = await DeploymentWorkspace.create(runProcess, {
        root,
        prefix: "api",
        onCleanupError: () => undefined,
      });
      created = workspace.path;
      expect((await stat(created)).isDirectory()).toBe(true);
    }

    expect(created.startsWith(join(root, "api-"))).toBe(true);
    expect(await stat(created).catch(() => null)).toBeNull();
  });

  test("throws WorkspaceCommandError when the root cannot be created", async () => {
    const error = await DeploymentWorkspace.create(runProcess, {
      root: "/proc/nelcota",
      prefix: "api",
      onCleanupError: () => undefined,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(WorkspaceCommandError);
  });
});

describe("DeploymentWorkspace cleanup", () => {
  test("reports a failed removal instead of throwing", async () => {
    const root = await mkdtemp(join(tmpdir(), "nelcota-root-"));
    const reported: string[] = [];
    const failingRemoval: CommandRunner = async (command, options) =>
      command[0] === "rm"
        ? await Promise.resolve({
            exitCode: 1,
            stdout: "",
            stderr: "rm: cannot remove: Device or resource busy\n",
            timedOut: false,
            aborted: false,
          })
        : await runProcess(command, options);

    const workspace = await DeploymentWorkspace.create(failingRemoval, {
      root,
      prefix: "api",
      onCleanupError: (message) => reported.push(message),
    });
    await workspace[Symbol.asyncDispose]();

    expect(reported).toHaveLength(1);
    expect(reported[0]).toContain("Device or resource busy");
  });
});
