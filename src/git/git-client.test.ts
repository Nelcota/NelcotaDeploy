import { describe, expect, test } from "bun:test";

import { runProcess } from "@/process";

import { credentialArgs, gitEnvironment } from "./git-client";

const TOKEN = "ghp_secret-token-value";

async function fillCredentials(token: string | null): Promise<string> {
  const result = await runProcess(
    [
      "sh",
      "-c",
      'printf "protocol=https\\nhost=github.com\\n\\n" | git "$@" credential fill',
      "sh",
      ...credentialArgs(token),
    ],
    { timeoutInMs: 10_000, env: { ...gitEnvironment(token), GIT_ASKPASS: "/bin/false" } },
  );
  return result.stdout;
}

describe("git credentials", () => {
  test("hands the token to git through the inline credential helper", async () => {
    const output = await fillCredentials(TOKEN);

    expect(output).toContain("username=x-access-token");
    expect(output).toContain(`password=${TOKEN}`);
  });

  test("keeps the token out of the command arguments", () => {
    const args = credentialArgs(TOKEN);

    expect(args.join(" ")).not.toContain(TOKEN);
  });

  test("adds no credential options for a public repository", () => {
    expect(credentialArgs(null)).toEqual([]);
    expect(credentialArgs("  ")).toEqual([]);
  });

  test("never prompts for credentials", () => {
    expect(gitEnvironment(null)["GIT_TERMINAL_PROMPT"]).toBe("0");
  });
});
