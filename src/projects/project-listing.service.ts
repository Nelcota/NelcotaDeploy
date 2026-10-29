import { and, asc, desc, eq, inArray, isNull, like, or, type SQL, sql } from "drizzle-orm";

import { type Database, tables } from "@/db";

import { type Project, projectColumns } from "./project.service";

const MAX_SEARCH_LENGTH = 100;

/** Project row in listings, with its latest deployment and container state. */
export type ProjectSummary = Project & {
  readonly latestDeployment: {
    readonly id: string;
    readonly status: string;
    readonly commitSha: string | null;
    readonly createdAt: string;
    readonly finishedAt: string | null;
  } | null;
  readonly containerState: string | null;
  readonly containerHealth: string | null;
};

/**
 * Lists projects with their latest deployment and container state, without N+1 queries.
 *
 * @param database - Database.
 * @param options - Optional name, slug or repository search.
 * @returns Projects sorted by name.
 */
export function listProjects(
  database: Database,
  options: { readonly search?: string } = {},
): ProjectSummary[] {
  const projects = database
    .select(projectColumns)
    .from(tables.projects)
    .where(and(isNull(tables.projects.deletionRequestedAt), searchCondition(options.search ?? "")))
    .orderBy(asc(tables.projects.name))
    .all();
  if (projects.length === 0) {
    return [];
  }
  const projectIds = projects.map((project) => project.id);
  const latestByProject = new Map(
    findLatestDeployments(database, projectIds).map((deployment) => [
      deployment.projectId,
      deployment,
    ]),
  );
  const snapshotByDeployment = findLatestSnapshots(database, projectIds);
  return projects.map((project) => {
    const snapshot =
      snapshotByDeployment.get(`${project.id}:${project.currentDeploymentId}`) ?? null;
    return Object.assign(project, {
      latestDeployment: latestByProject.get(project.id) ?? null,
      containerState: snapshot?.state ?? null,
      containerHealth: snapshot?.health ?? null,
    });
  });
}

/** Matches name, slug or repository, with LIKE wildcards in the search taken literally. */
function searchCondition(rawSearch: string): SQL | undefined {
  const search = rawSearch.trim().slice(0, MAX_SEARCH_LENGTH);
  if (search === "") {
    return undefined;
  }
  const pattern = `%${search.replaceAll(/[%_\\]/g, (character) => `\\${character}`)}%`;
  return or(
    sql`${tables.projects.name} LIKE ${pattern} ESCAPE '\\'`,
    sql`${tables.projects.slug} LIKE ${pattern} ESCAPE '\\'`,
    like(tables.projects.repositoryFullName, pattern),
  );
}

function findLatestDeployments(database: Database, projectIds: readonly string[]) {
  return database
    .select({
      id: tables.deployments.id,
      projectId: tables.deployments.projectId,
      status: tables.deployments.status,
      commitSha: tables.deployments.commitSha,
      createdAt: tables.deployments.createdAt,
      finishedAt: tables.deployments.finishedAt,
    })
    .from(tables.deployments)
    .where(
      and(
        inArray(tables.deployments.projectId, projectIds),
        eq(
          tables.deployments.id,
          sql`(
            SELECT latest.id FROM deployments AS latest
            WHERE latest.project_id = ${tables.deployments.projectId}
            ORDER BY latest.created_at DESC, latest.id DESC
            LIMIT 1
          )`,
        ),
      ),
    )
    .all();
}

/** Newest container snapshot per project and deployment, keyed by "projectId:deploymentId". */
function findLatestSnapshots(database: Database, projectIds: readonly string[]) {
  const snapshots = database
    .select({
      projectId: tables.containerSnapshots.projectId,
      deploymentId: tables.containerSnapshots.deploymentId,
      state: tables.containerSnapshots.state,
      health: tables.containerSnapshots.health,
    })
    .from(tables.containerSnapshots)
    .where(inArray(tables.containerSnapshots.projectId, projectIds))
    .orderBy(desc(tables.containerSnapshots.observedAt))
    .all();
  // Oldest first, so the newest snapshot of each key wins in the Map.
  return new Map(
    snapshots
      .toReversed()
      .map((snapshot) => [`${snapshot.projectId}:${snapshot.deploymentId}`, snapshot]),
  );
}
