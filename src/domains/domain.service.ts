import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import { type Actor, recordAuditEvent } from "@/audit";
import { type Database, tables } from "@/db";
import { getProject } from "@/projects";
import { assertHostnameOwnership, getSystemSettings } from "@/settings";
import type { DomainInput } from "@/shared/schemas/domain.schema";
import type { SystemSettings } from "@/shared/schemas/settings.schema";

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

/** A hostname a live deployment answers on, with the project it belongs to. */
export type LiveDomain = {
  readonly projectId: string;
  readonly projectName: string;
  readonly hostname: string;
  readonly httpsEnabled: boolean;
};

/**
 * Lists the hostnames of every project with a live deployment, automatic ones included, in two
 * queries whatever the number of projects.
 *
 * @param database - Database.
 * @param settings - System settings with the optional base domain.
 * @param projectIds - Visible projects, or null for all projects.
 * @returns The hostnames, grouped by project.
 */
export function listLiveDomains(
  database: Database,
  settings: SystemSettings,
  projectIds: readonly string[] | null = null,
): LiveDomain[] {
  const projects = database
    .select({ id: tables.projects.id, name: tables.projects.name, slug: tables.projects.slug })
    .from(tables.projects)
    .where(
      and(
        isNull(tables.projects.deletionRequestedAt),
        isNotNull(tables.projects.currentDeploymentId),
        projectIds == null ? undefined : inArray(tables.projects.id, projectIds),
      ),
    )
    .all();
  if (projects.length === 0) {
    return [];
  }
  const custom = database
    .select({
      projectId: tables.domains.projectId,
      hostname: tables.domains.hostname,
      httpsEnabled: tables.domains.httpsEnabled,
    })
    .from(tables.domains)
    .where(
      inArray(
        tables.domains.projectId,
        projects.map((project) => project.id),
      ),
    )
    .all();
  const customByProject = Map.groupBy(custom, (domain) => domain.projectId);
  return projects.flatMap((project) => {
    const domains = customByProject.get(project.id) ?? [];
    const automatic = automaticHostname(project.slug, settings);
    const all =
      automatic == null || domains.some((domain) => domain.hostname === automatic)
        ? domains
        : [{ hostname: automatic, httpsEnabled: settings.httpsByDefault }, ...domains];
    return all.map((domain) => ({
      projectId: project.id,
      projectName: project.name,
      hostname: domain.hostname,
      httpsEnabled: domain.httpsEnabled,
    }));
  });
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
    {
      id: null,
      hostname: automatic,
      httpsEnabled: settings.httpsByDefault,
      automatic: true,
    },
    ...custom,
  ];
}

/**
 * Adds a custom hostname. It takes effect on the next deployment or redeploy.
 *
 * @param database - Database.
 * @param addition - Project id, validated hostname and HTTPS flag, and who adds it.
 * @throws {DomainTakenError} When the hostname already belongs to a project.
 * @throws {ProjectNotFoundError} When the project does not exist.
 */
export function addDomain(
  database: Database,
  {
    projectId,
    input,
    actor,
  }: {
    readonly projectId: string;
    readonly input: DomainInput;
    readonly actor: Actor;
  },
): void {
  getProject(database, projectId);
  database.transaction(
    (transaction) => {
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
      assertHostnameOwnership(transaction, getSystemSettings(transaction));
      recordAuditEvent(transaction, {
        actor,
        action: "domain.add",
        targetType: "project",
        targetId: projectId,
        metadata: { hostname: input.hostname, httpsEnabled: input.httpsEnabled },
      });
    },
    { behavior: "immediate" },
  );
}

/**
 * Removes a custom hostname. It stops routing on the next deployment or redeploy.
 *
 * @param database - Database.
 * @param removal - Owning project, domain id and who removes it.
 * @throws {DomainNotFoundError} When the domain is not in this project.
 */
export function removeDomain(
  database: Database,
  {
    projectId,
    domainId,
    actor,
  }: {
    readonly projectId: string;
    readonly domainId: string;
    readonly actor: Actor;
  },
): void {
  database.transaction(
    (transaction) => {
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
    },
    { behavior: "immediate" },
  );
}
