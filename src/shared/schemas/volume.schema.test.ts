import { describe, expect, test } from "bun:test";

import { isAllowedMountPath, mountPathsOverlap, volumeInputSchema } from "./volume.schema";

describe("isAllowedMountPath", () => {
  test.each([["/data"], ["/app/data"], ["/var/lib/postgresql/data"], ["/srv/uploads_2"]])(
    "accepts %p",
    (path) => {
      expect(isAllowedMountPath(path)).toBe(true);
    },
  );

  test.each([
    ["/"],
    ["data"],
    ["/app/../etc"],
    ["/app/./data"],
    ["/app/data/"],
    ["/app//data"],
    ["/etc"],
    ["/etc/nginx"],
    ["/proc/self"],
    ["/usr/local/data"],
    ["/app/da ta"],
    ["/app/data,readonly"],
    [`/${"a".repeat(200)}`],
  ])("rejects %p", (path) => {
    expect(isAllowedMountPath(path)).toBe(false);
  });

  test("allows a directory that only starts like a system one", () => {
    expect(isAllowedMountPath("/etcetera")).toBe(true);
  });
});

describe("mountPathsOverlap", () => {
  test.each([
    ["/data", "/data"],
    ["/data", "/data/uploads"],
    ["/data/uploads", "/data"],
  ])("finds %p and %p overlapping", (first, second) => {
    expect(mountPathsOverlap(first, second)).toBe(true);
  });

  test("keeps sibling paths with a common prefix apart", () => {
    expect(mountPathsOverlap("/data", "/data2")).toBe(false);
  });
});

describe("volumeInputSchema", () => {
  test("trims the path", () => {
    expect(volumeInputSchema.parse({ mountPath: "  /data " })).toEqual({ mountPath: "/data" });
  });

  test("explains a rejected path in Portuguese", () => {
    const result = volumeInputSchema.safeParse({ mountPath: "/etc" });

    expect(result.error?.issues[0]?.message).toContain("caminho absoluto");
  });
});
