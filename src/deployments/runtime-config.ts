import { eq } from "drizzle-orm";

import { type Database, tables } from "@/db";
import { listProjectDomains } from "@/domains";
import { listEnvironmentVariables } from "@/environments";
import { getProject } from "@/projects";
import { getSystemSettings } from "@/settings";

/**
 * Fingerprints what a container receives besides its image: the variables and the domains.
 *
 * @remarks
 * Values are left out on purpose, so no secret ends up hashed in the database: a variable
 * counts as changed when it is saved again (its `updatedAt` moves), added or removed.
 *
 * @param database - Database.
 * @param projectId - Project whose configuration is fingerprinted.
 * @returns A SHA-256 hex digest that changes whenever a redeploy would apply something new.
 * @throws {ProjectNotFoundError} When the project does not exist.
 */
export function runtimeConfigFingerprint(database: Database, projectId: string): string {
  const variables = listEnvironmentVariables(database, projectId).map((variable) => [
    variable.key,
    variable.kind,
    variable.availableAtBuild,
    variable.updatedAt,
  ]);
  const domains = listProjectDomains(database, projectId, getSystemSettings(database))
    .map((domain) => [domain.hostname, domain.httpsEnabled] as const)
    .toSorted(([left], [right]) => left.localeCompare(right));
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(JSON.stringify({ variables, domains }));
  return hasher.digest("hex");
}

/**
 * Fingerprints the variables passed to the build, which only a new build applies.
 *
 * @param database - Database.
 * @param projectId - Project whose build variables are fingerprinted.
 * @returns A SHA-256 hex digest that changes when a build variable is saved, added or removed.
 */
export function buildConfigFingerprint(database: Database, projectId: string): string {
  const variables = listEnvironmentVariables(database, projectId)
    .filter((variable) => variable.availableAtBuild)
    .map((variable) => [variable.key, variable.kind, variable.updatedAt] as const)
    .toSorted(([left], [right]) => left.localeCompare(right));
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(JSON.stringify(variables));
  return hasher.digest("hex");
}

/**
 * Tells whether variables or domains changed since the live container was started, so the
 * interface can offer to apply them with a redeploy.
 *
 * @param database - Database.
 * @param projectId - Project to check.
 * @returns False without a live deployment or when it predates fingerprints.
 * @throws {ProjectNotFoundError} When the project does not exist.
 */
export function hasPendingRuntimeChanges(database: Database, projectId: string): boolean {
  const project = getProject(database, projectId);
  if (project.currentDeploymentId == null) {
    return false;
  }
  const live = database
    .select({ hash: tables.deployments.runtimeConfigHash })
    .from(tables.deployments)
    .where(eq(tables.deployments.id, project.currentDeploymentId))
    .get();
  if (live?.hash == null) {
    return false;
  }
  return live.hash !== runtimeConfigFingerprint(database, projectId);
}
