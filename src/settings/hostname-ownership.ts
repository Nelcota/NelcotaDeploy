import { eq } from "drizzle-orm";

import { getConfig } from "@/config";
import { type Database, tables } from "@/db";

import { HostnameConflictError } from "./settings.errors";

/**
 * Rejects collisions between custom, automatic, preview and panel hostnames.
 *
 * @param database - Database or transaction containing the proposed change.
 * @param options - Base domain after the change and, for tests, the panel's public URL.
 * @throws {HostnameConflictError} When different routes claim one hostname.
 */
export function assertHostnameOwnership(
  database: Pick<Database, "select">,
  options: { readonly baseDomain: string | null; readonly publicUrl?: string },
): void {
  const projects = database
    .select({ id: tables.projects.id, slug: tables.projects.slug })
    .from(tables.projects)
    .all();
  const domains = database
    .select({ owner: tables.domains.projectId, hostname: tables.domains.hostname })
    .from(tables.domains)
    .all();
  const previews = database
    .select({
      id: tables.previews.id,
      projectId: tables.previews.projectId,
      number: tables.previews.pullRequestNumber,
    })
    .from(tables.previews)
    .where(eq(tables.previews.status, "active"))
    .all();
  const slugs = new Map(projects.map((project) => [project.id, project.slug]));
  const automatic =
    options.baseDomain == null
      ? []
      : projects.map((project) => ({
          owner: project.id,
          hostname: `${project.slug}.${options.baseDomain}`,
        }));
  const previewClaims =
    options.baseDomain == null
      ? []
      : previews.map((preview) => {
          const slug = slugs.get(preview.projectId);
          if (slug == null) {
            throw new Error(`Preview ${preview.id} references a missing project`);
          }
          return {
            owner: `preview:${preview.id}`,
            hostname: `${slug}-pr-${preview.number}.${options.baseDomain}`,
          };
        });
  const owners = new Map([
    [new URL(options.publicUrl ?? getConfig().PUBLIC_URL).hostname, "panel"],
  ]);
  for (const claim of [...automatic, ...previewClaims, ...domains]) {
    const previous = owners.get(claim.hostname);
    if (previous != null && previous !== claim.owner) {
      throw new HostnameConflictError(claim.hostname);
    }
    owners.set(claim.hostname, claim.owner);
  }
}
