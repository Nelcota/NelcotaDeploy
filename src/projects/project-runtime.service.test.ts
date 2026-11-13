import { expect, test } from "bun:test";

import { projectRuntimeStatus } from "./project-runtime.service";

test.each([
  [null, [], "never-deployed"],
  ["current", [], "unmonitored"],
  ["current", [{ state: "restarting", health: null }], "offline"],
  ["current", [{ state: "exited", health: null }], "offline"],
  ["current", [{ state: "running", health: null }], "online"],
  ["current", [{ state: "running", health: "unhealthy" }], "unhealthy"],
] as const)("classifies release %s with observations %j as %s", (release, snapshots, status) => {
  expect(projectRuntimeStatus(release, snapshots)).toBe(status);
});
