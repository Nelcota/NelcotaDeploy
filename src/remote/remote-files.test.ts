import { describe, expect, test } from "bun:test";

import { assertServerFilePath } from "./remote-files";
import { RemoteFileError } from "./remote.errors";

describe("assertServerFilePath", () => {
  test("accepts an absolute path of plain segments", () => {
    expect(assertServerFilePath("/var/lib/nelcota/workspaces/backup-1.dump")).toBe(
      "/var/lib/nelcota/workspaces/backup-1.dump",
    );
  });

  test.each([["relative/file"], ["/var/../etc/passwd"], ["/tmp/a b"], ["/tmp/$(id)"], ["/"]])(
    "throws RemoteFileError for %p",
    (path) => {
      expect(() => assertServerFilePath(path)).toThrow(RemoteFileError);
    },
  );
});
