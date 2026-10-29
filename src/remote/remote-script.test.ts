import { describe, expect, test } from "bun:test";

import { buildRemoteScript, parsePidLine, quoteForShell } from "./remote-script";
import { InvalidRemoteCommandError } from "./remote.errors";

async function runScript(script: string): Promise<{ stdout: string; stderr: string }> {
  const child = Bun.spawn(["sh", "-s"], {
    stdin: new Blob([script]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  await child.exited;
  return { stdout, stderr };
}

describe("quoteForShell", () => {
  test.each([
    ["plain"],
    ["two words"],
    ["it's"],
    ["$(id) `id` $HOME ; | & > <"],
    ["line\nbreak"],
    ["back\\slash"],
    [""],
    ["-n"],
  ])("keeps %p literal through a real shell", async (value) => {
    const child = Bun.spawn(["sh", "-c", `printf %s ${quoteForShell(value)}`], { stdout: "pipe" });

    const printed = await new Response(child.stdout).text();

    expect(printed).toBe(value);
  });

  test("throws InvalidRemoteCommandError for a NUL byte", () => {
    expect(() => quoteForShell("a\0b")).toThrow(InvalidRemoteCommandError);
  });
});

describe("buildRemoteScript", () => {
  test("runs the command with its environment and directory, reporting its pid first", async () => {
    const script = buildRemoteScript({
      command: ["sh", "-c", 'printf "%s|%s" "$SECRET" "$(pwd)"'],
      env: { SECRET: "va'lue $(id)" },
      cwd: "/tmp",
    });

    const result = await runScript(script);

    expect(result.stdout).toBe("va'lue $(id)|/tmp");
    expect(parsePidLine(result.stderr.split("\n")[0] ?? "")).toBeGreaterThan(1);
  });

  test("keeps environment values out of the command line", () => {
    const script = buildRemoteScript({ command: ["env"], env: { TOKEN: "secret" } });

    expect(script.split("\n").at(-2)).toBe("exec 'env'");
  });

  test("stops with exit code 125 when the directory is missing", async () => {
    const child = Bun.spawn(["sh", "-s"], {
      stdin: new Blob([buildRemoteScript({ command: ["true"], cwd: "/nelcota/missing" })]),
      stderr: "ignore",
    });

    expect(await child.exited).toBe(125);
  });

  test("throws InvalidRemoteCommandError for an invalid variable name", () => {
    const build = () => buildRemoteScript({ command: ["true"], env: { "A;rm -rf /": "x" } });

    expect(build).toThrow(InvalidRemoteCommandError);
  });

  test("throws InvalidRemoteCommandError for an empty command", () => {
    expect(() => buildRemoteScript({ command: [] })).toThrow(InvalidRemoteCommandError);
  });
});

describe("parsePidLine", () => {
  test("reads the pid marker", () => {
    expect(parsePidLine("NELCOTA_PID 4242")).toBe(4242);
  });

  test.each([["error: something"], ["NELCOTA_PID 1"], ["NELCOTA_PID abc"], [""]])(
    "returns null for %p",
    (line) => {
      expect(parsePidLine(line)).toBeNull();
    },
  );
});
