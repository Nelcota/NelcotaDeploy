import { describe, expect, test } from "bun:test";

import { containerAccent, matchesApplicationFilter } from "./project-accent";

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
    expect(matchesApplicationFilter("all", null, null)).toBe(true);
  });

  test("lists a healthy running container as online", () => {
    expect(matchesApplicationFilter("online", "running", "healthy")).toBe(true);
  });

  test("does not list an unhealthy container as online", () => {
    expect(matchesApplicationFilter("online", "running", "unhealthy")).toBe(false);
  });

  test("lists a stopped container under attention", () => {
    expect(matchesApplicationFilter("attention", "exited", null)).toBe(true);
  });

  test("lists a restarting container under attention", () => {
    expect(matchesApplicationFilter("attention", "restarting", null)).toBe(true);
  });

  test("does not list a project never deployed under attention", () => {
    expect(matchesApplicationFilter("attention", null, null)).toBe(false);
  });

  test("lists a project without container as never deployed", () => {
    expect(matchesApplicationFilter("never-deployed", null, null)).toBe(true);
  });
});
