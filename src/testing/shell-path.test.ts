import { expect, test } from "bun:test";

import { fromShellPath, toShellPath } from "./shell-path";

test("round-trips Windows fixture paths through the POSIX shell", () => {
  expect(toShellPath("C:\\Users\\Test User\\fixture", "win32")).toBe("/c/Users/Test User/fixture");
  expect(fromShellPath("/c/Users/Test User/fixture", "win32")).toBe("C:/Users/Test User/fixture");
});

test("preserves POSIX fixture paths on Linux", () => {
  expect(toShellPath("/tmp/fixture", "linux")).toBe("/tmp/fixture");
  expect(fromShellPath("/tmp/fixture", "linux")).toBe("/tmp/fixture");
});

test("keeps paths without a Windows drive unchanged", () => {
  expect(toShellPath("/tmp/fixture", "win32")).toBe("/tmp/fixture");
  expect(fromShellPath("/tmp/fixture", "win32")).toBe("/tmp/fixture");
});

test.each(["", "  "])("rejects an empty fixture path %p", (path) => {
  expect(() => toShellPath(path)).toThrow(RangeError);
  expect(() => fromShellPath(path)).toThrow(RangeError);
});
