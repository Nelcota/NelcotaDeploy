import { configureGitHubLogin } from "@/auth";
import { getDatabase } from "@/db";
import { getGitHubApp, readGitHubLoginCredentials } from "@/github";
import { createLogger } from "@/logging";
import { getSecretBox } from "@/secrets";

let loading: Promise<void> | null = null;

/**
 * Reads the GitHub App's OAuth client and turns "Sign in with GitHub" on or off to match. A
 * failure only turns GitHub sign-in off, so e-mail sign-in keeps working.
 */
export async function refreshGitHubLogin(): Promise<void> {
  try {
    const database = getDatabase();
    // Checked first, so a panel without an app never needs the encryption key here.
    const credentials =
      getGitHubApp(database) == null
        ? null
        : await readGitHubLoginCredentials(database, await getSecretBox());
    configureGitHubLogin(credentials);
  } catch (error) {
    createLogger("github-login").error({ err: error }, "could not load the GitHub sign-in");
    configureGitHubLogin(null);
  }
}

/** Loads the GitHub sign-in once per process, before the first request needs it. */
export async function ensureGitHubLoginConfigured(): Promise<void> {
  loading ??= refreshGitHubLogin();
  await loading;
}
