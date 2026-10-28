import { describe, expect, test } from "bun:test";

import { containerAccent, deploymentAccent, type RowAccent } from "./project-accent";

describe("containerAccent", () => {
  test("is neutral for a project never deployed", () => {
    expect(containerAccent(null, null)).toBe("neutral");
  });

  test("is green for a running container", () => {
    expect(containerAccent("running", "healthy")).toBe("success");
  });

  test("is red for a running but unhealthy container", () => {
    expect(containerAccent("running", "unhealthy")).toBe("danger");
  });

  test("is amber while restarting and red when stopped", () => {
    expect(containerAccent("restarting", null)).toBe("warning");
    expect(containerAccent("exited", null)).toBe("danger");
  });
});

describe("deploymentAccent", () => {
  test.each<[string, RowAccent]>([
    ["succeeded", "success"],
    ["failed", "danger"],
    ["cancelled", "neutral"],
    ["building", "progress"],
  ])("maps %p to %p", (status, accent) => {
    expect(deploymentAccent(status)).toBe(accent);
  });
});
