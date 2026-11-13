import { describe, expect, test } from "bun:test";

import {
  containerAccent,
  matchesApplicationFilter,
} from "@/web/components/projects/project-accent";

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

describe("matchesApplicationFilter", () => {
  test("lists every project under all", () => {
    expect(matchesApplicationFilter("all", "never-deployed")).toBe(true);
  });

  test("lists a healthy running container as online", () => {
    expect(matchesApplicationFilter("online", "online")).toBe(true);
  });

  test("does not list an unhealthy container as online", () => {
    expect(matchesApplicationFilter("online", "unhealthy")).toBe(false);
  });

  test("lists a stopped container under attention", () => {
    expect(matchesApplicationFilter("attention", "offline")).toBe(true);
  });

  test("lists a published project with no monitoring under attention", () => {
    expect(matchesApplicationFilter("attention", "unmonitored")).toBe(true);
  });

  test("does not list a project never deployed under attention", () => {
    expect(matchesApplicationFilter("attention", "never-deployed")).toBe(false);
  });

  test("only lists a project without a published release as never deployed", () => {
    expect(matchesApplicationFilter("never-deployed", "never-deployed")).toBe(true);
    expect(matchesApplicationFilter("never-deployed", "unmonitored")).toBe(false);
  });
});
