import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";

import { type CommandRunner, runProcess } from "@/process";
import { fromShellPath, toShellPath } from "@/testing";

import { PathOutsideWorkspaceError, WorkspaceCommandError } from "../worker.errors";
import { DeploymentWorkspace, resolveInsideWorkspace } from "./workspace";

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "nelcota-ws-"));
  await mkdir(join(root, "apps"));
  await writeFile(join(root, "apps", "Dockerfile"), "FROM scratch\n");
  return toShellPath(root);
}

describe("resolveInsideWorkspace", () => {
  test("resolves a path inside the repository", async () => {
    const root = await repository();

    const path = await resolveInsideWorkspace(runProcess, root, "apps/Dockerfile");

    expect(path.endsWith("apps/Dockerfile")).toBe(true);
  });

  test("resolves files whose names start with two dots", async () => {
    const root = await repository();
    await writeFile(fromShellPath(posix.join(root, "..notes")), "example");

    const path = await resolveInsideWorkspace(runProcess, root, "..notes");

    expect(posix.basename(path)).toBe("..notes");
  });

  test("throws PathOutsideWorkspaceError for a symlink pointing outside", async () => {
    const root = await repository();
    const outside = await repository();
    await symlink(
      fromShellPath(posix.join(outside, "apps/Dockerfile")),
      fromShellPath(posix.join(root, "Dockerfile")),
    );

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

  test.each(["", " ", "../Dockerfile", "/Dockerfile", "notes\n.txt", "notes\r.txt", "notes\0.txt"])(
    "rejects an invalid repository path before running a command",
    async (path) => {
      const run: CommandRunner = () => Promise.reject(new Error("unexpected command"));

      const error = await resolveInsideWorkspace(run, "/repository", path).catch(
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(PathOutsideWorkspaceError);
    },
  );

  test.each([
    "/repository.\n/repository/Dockerfile.\nextra.\n",
    "/repository\n/repository/Dockerfile\n",
    "/repository.\nrelative.\n",
    "",
  ])("rejects incomplete or ambiguous realpath output", async (stdout) => {
    const run: CommandRunner = () =>
      Promise.resolve({ exitCode: 0, stdout, stderr: "", timedOut: false, aborted: false });

    const error = await resolveInsideWorkspace(run, "/repository", "Dockerfile").catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(WorkspaceCommandError);
  });

  test("reports a path command timeout without copying its diagnostic", async () => {
    const run: CommandRunner = () =>
      Promise.resolve({
        exitCode: 44,
        stdout: "",
        stderr: "private command diagnostic",
        timedOut: true,
        aborted: false,
      });

    const error = await resolveInsideWorkspace(run, "/repository", "Dockerfile").catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(WorkspaceCommandError);
    expect(error).toHaveProperty("message", "Workspace command failed: realpath timed out");
  });
});

describe("DeploymentWorkspace", () => {
  test("creates a fresh directory under the root and removes it when disposed", async () => {
    const root = toShellPath(await mkdtemp(join(tmpdir(), "nelcota-root-")));
    let created = "";

    {
      await using workspace = await DeploymentWorkspace.create(runProcess, {
        root,
        prefix: "api",
        onCleanupError: () => undefined,
      });
      created = workspace.path;
      expect((await stat(fromShellPath(created))).isDirectory()).toBe(true);
    }

    expect(created.startsWith(posix.join(root, "api-"))).toBe(true);
    expect(await stat(fromShellPath(created)).catch(() => null)).toBeNull();
  });

  test("throws WorkspaceCommandError when the root cannot be created", async () => {
    const error = await DeploymentWorkspace.create(runProcess, {
      root: "/proc/nelcota",
      prefix: "api",
      onCleanupError: () => undefined,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(WorkspaceCommandError);
  });

  test.each(["", "/other/api-test\n", "/checkout/api-test/child\n", "/checkout/other-test\n"])(
    "rejects unexpected mktemp output before creating a disposable workspace",
    async (stdout) => {
      const run: CommandRunner = ([command]) =>
        Promise.resolve({
          exitCode: 0,
          stdout: command === "mktemp" ? stdout : "",
          stderr: "",
          timedOut: false,
          aborted: false,
        });

      const error = await DeploymentWorkspace.create(run, {
        root: "/checkout",
        prefix: "api",
        onCleanupError: () => undefined,
      }).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(WorkspaceCommandError);
      expect(error).toHaveProperty(
        "message",
        "Workspace command failed: mktemp returned an invalid workspace directory",
      );
    },
  );
});

describe("DeploymentWorkspace cleanup", () => {
  test("reports a failed removal instead of throwing", async () => {
    const root = toShellPath(await mkdtemp(join(tmpdir(), "nelcota-root-")));
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
