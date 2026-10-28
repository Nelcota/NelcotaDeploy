import { and, asc, eq } from "drizzle-orm";

import { type Actor, recordAuditEvent } from "@/audit";
import { type Database, tables } from "@/db";
import { getProject } from "@/projects";
import type { DomainInput } from "@/shared/domain.schema";
import type { SystemSettings } from "@/shared/settings.schema";

import { DomainNotFoundError, DomainTakenError } from "./domain.errors";

/** A hostname routed to a project. Automatic domains come from the base domain setting. */
export type ProjectDomain = {
  readonly id: string | null;
  readonly hostname: string;
  readonly httpsEnabled: boolean;
  readonly automatic: boolean;
};

/**
 * Returns the automatic hostname of a project, such as "api.apps.example.com".
 *
 * @param projectSlug - Project slug.
 * @param settings - System settings with the optional base domain.
 * @returns The hostname, or null when no base domain is configured.
 */
function automaticHostname(projectSlug: string, settings: SystemSettings): string | null {
  return settings.baseDomain == null ? null : `${projectSlug}.${settings.baseDomain}`;
}

/**
 * Lists the hostnames a project answers on, including its automatic one.
 *
 * @param database - Database.
 * @param projectId - Project id.
 * @param settings - System settings.
 * @returns Domains, automatic first.
 * @throws {ProjectNotFoundError} When the project does not exist.
 */
export function listProjectDomains(
  database: Database,
  projectId: string,
  settings: SystemSettings,
): ProjectDomain[] {
  const project = getProject(database, projectId);
  const custom = database
    .select({
      id: tables.domains.id,
      hostname: tables.domains.hostname,
      httpsEnabled: tables.domains.httpsEnabled,
    })
    .from(tables.domains)
    .where(eq(tables.domains.projectId, projectId))
    .orderBy(asc(tables.domains.hostname))
    .all()
    .map((domain) => Object.assign(domain, { automatic: false }));
  const automatic = automaticHostname(project.slug, settings);
  if (automatic == null || custom.some((domain) => domain.hostname === automatic)) {
    return custom;
  }
  return [
    { id: null, hostname: automatic, httpsEnabled: settings.httpsByDefault, automatic: true },
    ...custom,
  ];
}

/**
 * Adds a custom hostname. It takes effect on the next deployment or redeploy.
 *
 * @param database - Database.
 * @param projectId - Project id.
 * @param input - Validated hostname and HTTPS flag.
 * @param actor - Who adds it.
 * @throws {DomainTakenError} When the hostname already belongs to a project.
 * @throws {ProjectNotFoundError} When the project does not exist.
 */
export function addDomain(
  database: Database,
  projectId: string,
  input: DomainInput,
  actor: Actor,
): void {
  getProject(database, projectId);
  database.transaction((transaction) => {
    const existing = transaction
      .select({ id: tables.domains.id })
      .from(tables.domains)
      .where(eq(tables.domains.hostname, input.hostname))
      .get();
    if (existing != null) {
      throw new DomainTakenError(input.hostname);
    }
    transaction
      .insert(tables.domains)
      .values({
        id: Bun.randomUUIDv7(),
        projectId,
        hostname: input.hostname,
        httpsEnabled: input.httpsEnabled,
        createdAt: new Date().toISOString(),
      })
      .run();
    recordAuditEvent(transaction, {
      actor,
      action: "domain.add",
      targetType: "project",
      targetId: projectId,
      metadata: { hostname: input.hostname, httpsEnabled: input.httpsEnabled },
    });
  });
}

/**
 * Removes a custom hostname. It stops routing on the next deployment or redeploy.
 *
 * @param database - Database.
 * @param projectId - Owning project.
 * @param domainId - Domain id.
 * @param actor - Who removes it.
 * @throws {DomainNotFoundError} When the domain is not in this project.
 */
export function removeDomain(
  database: Database,
  projectId: string,
  domainId: string,
  actor: Actor,
): void {
  database.transaction((transaction) => {
    const removed = transaction
      .delete(tables.domains)
      .where(and(eq(tables.domains.id, domainId), eq(tables.domains.projectId, projectId)))
      .returning({ hostname: tables.domains.hostname })
      .get();
    if (removed == null) {
      throw new DomainNotFoundError(domainId);
    }
    recordAuditEvent(transaction, {
      actor,
      action: "domain.remove",
      targetType: "project",
      targetId: projectId,
      metadata: { hostname: removed.hostname },
    });
  });
}
