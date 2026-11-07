import { expect, test } from "bun:test";

import { availableVolumePaths } from "./volume-suggestions";

test("retains all distinct valid candidates when a Dockerfile declares multiple mounts", () => {
  expect(availableVolumePaths(["/uploads", "/data", "/data", "/etc", "relative"], [])).toEqual([
    "/data",
    "/uploads",
  ]);
});

test("excludes exact, parent and child paths of existing volumes, including detached ones", () => {
  expect(
    availableVolumePaths(
      ["/data", "/data/cache", "/app", "/app/uploads", "/other"],
      [{ mountPath: "/data" }, { mountPath: "/app/uploads" }],
    ),
  ).toEqual(["/other"]);
});

test("does not confuse common prefixes with nested paths", () => {
  expect(availableVolumePaths(["/database", "/uploads"], [{ mountPath: "/data" }])).toEqual([
    "/database",
    "/uploads",
  ]);
});
