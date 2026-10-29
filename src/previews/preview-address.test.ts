import { describe, expect, test } from "bun:test";

import { previewHostname, previewRouteName } from "./preview-address";

describe("previewHostname", () => {
  test("puts the pull request next to the project's automatic address", () => {
    expect(previewHostname("api", 12, "apps.example.com")).toBe("pr-12-api.apps.example.com");
  });

  test.each([[0], [-1], [1.5]])("throws RangeError for the number %p", (number) => {
    expect(() => previewHostname("api", number, "apps.example.com")).toThrow(RangeError);
  });
});

describe("previewRouteName", () => {
  test("keeps each preview's routes apart from production's", () => {
    expect(previewRouteName("project-1", 12)).toBe("project-1-pr-12");
  });
});
