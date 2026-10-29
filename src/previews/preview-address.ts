/**
 * Builds the address of a preview: "pr-<number>-<slug>.<base domain>", next to the project's
 * automatic one, so the base domain's wildcard DNS record already covers it.
 *
 * @param projectSlug - Project slug, at most 40 characters.
 * @param pullRequestNumber - Pull request number.
 * @param baseDomain - The organization's base domain.
 * @returns The preview hostname.
 * @throws {RangeError} When the number is not a positive integer.
 */
export function previewHostname(
  projectSlug: string,
  pullRequestNumber: number,
  baseDomain: string,
): string {
  if (Number.isInteger(pullRequestNumber) === false || pullRequestNumber < 1) {
    throw new RangeError(`Invalid pull request number: ${pullRequestNumber}`);
  }
  return `pr-${pullRequestNumber}-${projectSlug}.${baseDomain}`;
}

/**
 * Names the route file and the proxy routers of a preview, apart from production's.
 *
 * @param projectId - Project id.
 * @param pullRequestNumber - Pull request number.
 * @returns A name unique per preview.
 */
export function previewRouteName(projectId: string, pullRequestNumber: number): string {
  return `${previewRoutePrefix(projectId)}${pullRequestNumber}`;
}

/**
 * Start shared by the route names of every preview of a project.
 *
 * @param projectId - Project id.
 * @returns The prefix.
 */
export function previewRoutePrefix(projectId: string): string {
  return `${projectId}-pr-`;
}
