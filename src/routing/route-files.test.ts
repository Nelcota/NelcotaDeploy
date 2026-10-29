import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type CommandRunner, runProcess } from "@/process";

import { RouteFiles } from "./route-files";
import { InvalidRouteError, RouteFileError } from "./routing.errors";

const CONFIG = { http: { middlewares: { x: { compress: {} } } } };

async function routeDirectory(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "nelcota-routes-")), "routes");
}

describe("RouteFiles", () => {
  test("creates the directory and writes the routes as JSON under a .yml name", async () => {
    const directory = await routeDirectory();

    await new RouteFiles(runProcess, directory).write("project-1", CONFIG);

    expect(await readdir(directory)).toEqual(["project-1.yml"]);
    expect(await Bun.file(join(directory, "project-1.yml")).json()).toEqual(CONFIG);
  });

  test("keeps text that looks like shell code as plain content", async () => {
    const directory = await routeDirectory();
    const tricky = { http: { middlewares: { x: { note: "$(touch /tmp/x) `id` \"' %s" } } } };

    await new RouteFiles(runProcess, directory).write("project-1", tricky);

    expect(await Bun.file(join(directory, "project-1.yml")).json()).toEqual(tricky);
  });

  test("removes the routes, and does nothing when they are already gone", async () => {
    const directory = await routeDirectory();
    const files = new RouteFiles(runProcess, directory);
    await files.write("project-1", CONFIG);

    await files.remove("project-1");
    await files.remove("project-1");

    expect(await readdir(directory)).toEqual([]);
  });
});

describe("RouteFiles validation", () => {
  test.each([["../escape"], ["a/b"], [""], ["UPPER"]])(
    "throws InvalidRouteError for the file name %p",
    async (name) => {
      const files = new RouteFiles(runProcess, await routeDirectory());

      const error = await files.write(name, CONFIG).catch((failure: unknown) => failure);

      expect(error).toBeInstanceOf(InvalidRouteError);
    },
  );

  test.each([["relative/dir"], ["/srv/../etc"], ["/srv/$(id)"]])(
    "throws InvalidRouteError for the directory %p",
    (directory) => {
      expect(() => new RouteFiles(runProcess, directory)).toThrow(InvalidRouteError);
    },
  );

  test("throws RouteFileError when the server refuses the write", async () => {
    const failing: CommandRunner = async () =>
      await Promise.resolve({
        exitCode: 1,
        stdout: "",
        stderr: "Permission denied",
        timedOut: false,
        aborted: false,
      });

    const error = await new RouteFiles(failing, "/routes")
      .write("project-1", CONFIG)
      .catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(RouteFileError);
  });
});
