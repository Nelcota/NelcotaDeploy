/** GitHub limits app names to 34 characters. */
const MAX_APP_NAME_LENGTH = 34;
const ORGANIZATION_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/** Path GitHub sends the browser back to, with the code that creates the app. */
const GITHUB_APP_CALLBACK_PATH = "/api/github/app/callback";
/** Path GitHub delivers webhooks to. */
const GITHUB_WEBHOOK_PATH = "/api/webhooks/github";

/**
 * Describes the GitHub App the panel needs: read access to code, commit statuses, and push
 * events delivered to the panel's webhook, so no repository needs a webhook of its own.
 *
 * @param publicUrl - The panel's PUBLIC_URL, without a trailing slash.
 * @returns The manifest GitHub's "create app from manifest" flow expects.
 */
export function buildAppManifest(publicUrl: string) {
  const host = new URL(publicUrl).host;
  return {
    name: `Nelcota ${host}`.slice(0, MAX_APP_NAME_LENGTH),
    url: publicUrl,
    hook_attributes: { url: `${publicUrl}${GITHUB_WEBHOOK_PATH}`, active: true },
    redirect_url: `${publicUrl}${GITHUB_APP_CALLBACK_PATH}`,
    // After an installation changes, GitHub brings the user back to the panel's settings.
    setup_url: `${publicUrl}/settings?tab=server`,
    setup_on_update: true,
    public: false,
    // Statuses: the result of each deployment shows on its commit and pull request. E-mail
    // addresses: "Sign in with GitHub" matches the verified e-mail with a panel account.
    default_permissions: {
      contents: "read",
      metadata: "read",
      statuses: "write",
      // Pull requests: each one to the project's branch can get a preview deployment.
      pull_requests: "read",
      email_addresses: "read",
    },
    callback_urls: [`${publicUrl}/api/auth/callback/github`],
    default_events: ["push", "pull_request"],
  };
}

/**
 * Tells whether a name can be a GitHub account (user or organization).
 *
 * @param name - Name typed by the user.
 * @returns True for 1–39 letters, digits or inner hyphens.
 */
export function isGitHubAccountName(name: string): boolean {
  return ORGANIZATION_PATTERN.test(name);
}

/**
 * Builds the GitHub page that creates the app, under the user's account or an organization.
 *
 * @param organization - Organization that will own the app, or null for the user's account.
 * @param state - Random value GitHub sends back, checked against the browser's cookie.
 * @returns The URL the manifest form posts to.
 * @throws {RangeError} When the organization name is not a valid GitHub account name.
 */
export function appRegistrationUrl(organization: string | null, state: string): string {
  if (organization != null && isGitHubAccountName(organization) === false) {
    throw new RangeError(`Invalid GitHub organization name: ${organization}`);
  }
  const base =
    organization == null
      ? "https://github.com/settings/apps/new"
      : `https://github.com/organizations/${organization}/settings/apps/new`;
  return `${base}?state=${encodeURIComponent(state)}`;
}
