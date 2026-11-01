import { dirname, join } from "node:path";

// Keeps test output readable; tests that need logs can set LOG_LEVEL explicitly.
process.env["LOG_LEVEL"] ??= "silent";

// Git for Windows ships the POSIX tools exercised by the Linux worker's shell tests.
async function configureWindowsShell(): Promise<void> {
  if (process.platform !== "win32" || Bun.which("sh") != null) {
    return;
  }
  const git = Bun.which("git");
  if (git == null) {
    return;
  }
  const directory = join(dirname(dirname(git)), "usr", "bin");
  if (await Bun.file(join(directory, "sh.exe")).exists()) {
    process.env["PATH"] = `${directory};${process.env["PATH"] ?? ""}`;
  }
}
await configureWindowsShell();
