import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PathOutsideWorkspaceError } from "./worker.errors";
import { resolveInsideWorkspace } from "./workspace";

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "nelcota-ws-"));
  await mkdir(join(root, "apps"));
  await writeFile(join(root, "apps", "Dockerfile"), "FROM scratch\n");
  return root;
}

describe("resolveInsideWorkspace", () => {
  test("resolves a path inside the repository", async () => {
    const root = await repository();

    const path = await resolveInsideWorkspace(root, "apps/Dockerfile");

    expect(path.endsWith("apps/Dockerfile")).toBe(true);
  });

  test("throws PathOutsideWorkspaceError for a symlink pointing outside", async () => {
    const root = await repository();
    await symlink("/etc/passwd", join(root, "Dockerfile"));

    const error = await resolveInsideWorkspace(root, "Dockerfile").catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(PathOutsideWorkspaceError);
  });

  test("throws PathOutsideWorkspaceError for a missing file", async () => {
    const root = await repository();

    const error = await resolveInsideWorkspace(root, "missing/Dockerfile").catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(PathOutsideWorkspaceError);
  });
});
