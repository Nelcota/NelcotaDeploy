import { expect, test } from "bun:test";

import { preferredDockerfile } from "./repository-defaults";

test.each([
  { files: [], expected: "" },
  { files: ["apps/api/Dockerfile"], expected: "apps/api/Dockerfile" },
  { files: ["Dockerfile", "apps/api/Dockerfile"], expected: "Dockerfile" },
  { files: ["apps/api/Dockerfile", "apps/web/Dockerfile"], expected: "" },
])("selects $expected for $files", ({ files, expected }) => {
  expect(preferredDockerfile(files)).toBe(expected);
});

test("requires a choice when a partial listing contains only one nested Dockerfile", () => {
  expect(preferredDockerfile(["apps/api/Dockerfile"], true)).toBe("");
});

test("can prefer the root Dockerfile even when the rest of the listing is partial", () => {
  expect(preferredDockerfile(["Dockerfile"], true)).toBe("Dockerfile");
});
