import { describe, expect, test } from "bun:test";

import { runProcess } from "@/process";

import { credentialArgs, GitClient, gitEnvironment } from "./git-client";

const TOKEN = "ghp_secret-token-value";

test.each([
  ["fatal: Remote branch missing not found in upstream origin", "branch_not_found"],
  ["remote: Repository not found.\nfatal: repository unavailable", "repository_access"],
  ["fatal: Authentication failed for 'https://github.com/example/web.git/'", "repository_access"],
  ["fatal: unable to access remote: Could not resolve host", null],
] as const)("classifies checkout failure %s", async (stderr, checkoutFailure) => {
  const git = new GitClient("git", () =>
    Promise.resolve({ exitCode: 128, stdout: "", stderr, aborted: false, timedOut: false }),
  );

  const checkout = git.checkoutRevision({
    cloneUrl: "https://github.com/example/web.git",
    branch: "missing",
    commitSha: null,
    directory: "/tmp/repository",
    token: null,
    timeoutInMs: 1000,
  });

  expect(await checkout.catch((error: unknown) => error)).toMatchObject({ checkoutFailure });
});

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
