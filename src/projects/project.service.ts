import { and, asc, desc, eq, inArray, isNull, like, or, sql } from "drizzle-orm";

import { type Actor, recordAuditEvent } from "@/audit";
import { type Database, tables, type Transaction } from "@/db";
import { enqueueJob } from "@/jobs";
import type { SecretBox } from "@/secrets";
import { parseGitHubRepository, type ProjectInput } from "@/shared/schemas/project.schema";

import { ProjectNotFoundError, ProjectSlugTakenError } from "./project.errors";

/** Name of the single environment every project has today. */
export const PRODUCTION_ENVIRONMENT = "production";
const MAX_SEARCH_LENGTH = 100;

const projectColumns = {
  id: tables.projects.id,
  name: tables.projects.name,
  slug: tables.projects.slug,
  serverId: tables.projects.serverId,
  repositoryUrl: tables.projects.repositoryUrl,
  repositoryFullName: tables.projects.repositoryFullName,
  branch: tables.projects.branch,
  dockerfilePath: tables.projects.dockerfilePath,
  buildContext: tables.projects.buildContext,
  internalPort: tables.projects.internalPort,
  healthCheckPath: tables.projects.healthCheckPath,
  autoDeploy: tables.projects.autoDeploy,
  deploymentsApproved: tables.projects.deploymentsApproved,
  currentDeploymentId: tables.projects.currentDeploymentId,
  hasRepositoryToken: sql<boolean>`${tables.projects.encryptedRepositoryToken} IS NOT NULL`.mapWith(
    Boolean,
  ),
  createdAt: tables.projects.createdAt,
  updatedAt: tables.projects.updatedAt,
};

/** A project as returned to callers. Credentials are never included. */
export type Project = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly serverId: string;
  readonly repositoryUrl: string;
  readonly repositoryFullName: string;
  readonly branch: string;
  readonly dockerfilePath: string;
  readonly buildContext: string;
  readonly internalPort: number;
  readonly healthCheckPath: string | null;
  readonly autoDeploy: boolean;
  readonly deploymentsApproved: boolean;
  readonly currentDeploymentId: string | null;
  readonly hasRepositoryToken: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
};

function repositoryTokenContext(projectId: string): string {
  return `project:${projectId}:repository-token`;
}

function isSlugTaken(
  database: Database | Transaction,
  slug: string,
  exceptProjectId?: string,
): boolean {
  const existing = database
    .select({ id: tables.projects.id })
    .from(tables.projects)
    .where(eq(tables.projects.slug, slug))
    .get();
  return existing != null && existing.id !== exceptProjectId;
}

function repositoryFullNameOf(repositoryUrl: string): { fullName: string; cloneUrl: string } {
  const repository = parseGitHubRepository(repositoryUrl);
  if (repository == null) {
    throw new Error(`Repository URL passed validation but cannot be parsed: ${repositoryUrl}`);
  }
  return repository;
}

/**
 * Creates a project with its production environment.
 *
 * @remarks
 * Building a repository runs its Dockerfile, so projects created by non-admins start
 * unapproved and cannot deploy until an admin approves them.
 *
 * @param database - Database.
 * @param input - Validated project fields.
 * @param creator - Creating user and whether they are an admin.
 * @returns The new project.
 * @throws {ProjectSlugTakenError} When the slug is already used.
 */
export function createProject(
  database: Database,
  input: ProjectInput,
  creator: { readonly actor: Actor; readonly userId: string | null; readonly isAdmin: boolean },
): Project {
  const repository = repositoryFullNameOf(input.repositoryUrl);
  const projectId = Bun.randomUUIDv7();
  const now = new Date().toISOString();
  database.transaction((transaction) => {
    if (isSlugTaken(transaction, input.slug)) {
      throw new ProjectSlugTakenError(input.slug);
    }
    transaction
      .insert(tables.projects)
      .values({
        id: projectId,
        ...input,
        repositoryUrl: repository.cloneUrl,
        repositoryFullName: repository.fullName,
        deploymentsApproved: creator.isAdmin,
        createdByUserId: creator.userId,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    transaction
      .insert(tables.environments)
      .values({ id: Bun.randomUUIDv7(), projectId, name: PRODUCTION_ENVIRONMENT, createdAt: now })
      .run();
    recordAuditEvent(transaction, {
      actor: creator.actor,
      action: "project.create",
      targetType: "project",
      targetId: projectId,
      metadata: { name: input.name, slug: input.slug, repository: repository.fullName },
    });
  });
  return getProject(database, projectId);
}

/**
 * Updates a project's configuration. Changes apply on the next deployment.
 *
 * @param database - Database.
 * @param change - Project to update, validated fields and the editor (actor and whether they
 *   are an admin).
 * @returns The updated project.
 * @throws {ProjectNotFoundError} When the project does not exist.
 * @throws {ProjectSlugTakenError} When the new slug is used by another project.
 */
export function updateProject(
  database: Database,
  {
    projectId,
    input,
    editor,
  }: {
    readonly projectId: string;
    readonly input: ProjectInput;
    readonly editor: { readonly actor: Actor; readonly isAdmin: boolean };
  },
): Project {
  const repository = repositoryFullNameOf(input.repositoryUrl);
  database.transaction((transaction) => {
    const current = findActiveProjectRow(transaction, projectId);
    if (isSlugTaken(transaction, input.slug, projectId)) {
      throw new ProjectSlugTakenError(input.slug);
    }
    // A different repository is different code, so a non-admin change needs new approval.
    const repositoryChanged = current.repositoryFullName !== repository.fullName;
    const deploymentsApproved =
      editor.isAdmin || (current.deploymentsApproved && repositoryChanged === false);
    transaction
      .update(tables.projects)
      .set({
        ...input,
        repositoryUrl: repository.cloneUrl,
        repositoryFullName: repository.fullName,
        deploymentsApproved,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(tables.projects.id, projectId))
      .run();
    recordAuditEvent(transaction, {
      actor: editor.actor,
      action: "project.update",
      targetType: "project",
      targetId: projectId,
      metadata: { slug: input.slug, repository: repository.fullName, branch: input.branch },
    });
  });
  return getProject(database, projectId);
}

/**
 * Approves a project for deployment. Only admins should call this.
 *
 * @param database - Database.
 * @param projectId - Project to approve.
 * @param actor - Approving admin.
 * @throws {ProjectNotFoundError} When the project does not exist.
 */
export function approveProject(database: Database, projectId: string, actor: Actor): void {
  database.transaction((transaction) => {
    findActiveProjectRow(transaction, projectId);
    transaction
      .update(tables.projects)
      .set({ deploymentsApproved: true, updatedAt: new Date().toISOString() })
      .where(eq(tables.projects.id, projectId))
      .run();
    recordAuditEvent(transaction, {
      actor,
      action: "project.approve",
      targetType: "project",
      targetId: projectId,
    });
  });
}

/**
 * Requests project deletion. The worker removes its containers and images and then the row.
 *
 * @param database - Database.
 * @param projectId - Project to delete.
 * @param actor - Who deletes it.
 * @throws {ProjectNotFoundError} When the project does not exist.
 */
export function requestProjectDeletion(database: Database, projectId: string, actor: Actor): void {
  database.transaction((transaction) => {
    const project = findActiveProjectRow(transaction, projectId);
    const now = new Date();
    transaction
      .update(tables.projects)
      .set({ deletionRequestedAt: now.toISOString(), autoDeploy: false })
      .where(eq(tables.projects.id, projectId))
      .run();
    transaction
      .update(tables.tasks)
      .set({ enabled: false })
      .where(eq(tables.tasks.projectId, projectId))
      .run();
    enqueueJob(
      transaction,
      { kind: "project_cleanup", projectId, dedupeKey: `cleanup:${projectId}`, maxAttempts: 3 },
      now,
    );
    recordAuditEvent(transaction, {
      actor,
      action: "project.delete",
      targetType: "project",
      targetId: projectId,
      metadata: { slug: project.slug },
    });
  });
}

/**
 * Stores or clears the read token for a private repository, encrypted at rest.
 *
 * @param database - Database.
 * @param secretBox - Encryption box.
 * @param change - Project to update, the token (or null to remove it) and who changes it.
 * @throws {ProjectNotFoundError} When the project does not exist.
 */
export async function setRepositoryToken(
  database: Database,
  secretBox: SecretBox,
  {
    projectId,
    token,
    actor,
  }: { readonly projectId: string; readonly token: string | null; readonly actor: Actor },
): Promise<void> {
  const encrypted =
    token == null || token === ""
      ? null
      : await secretBox.encrypt(token, repositoryTokenContext(projectId));
  database.transaction((transaction) => {
    findActiveProjectRow(transaction, projectId);
    transaction
      .update(tables.projects)
      .set({ encryptedRepositoryToken: encrypted, updatedAt: new Date().toISOString() })
      .where(eq(tables.projects.id, projectId))
      .run();
    recordAuditEvent(transaction, {
      actor,
      action:
        encrypted == null ? "project.repository_token_remove" : "project.repository_token_set",
      targetType: "project",
      targetId: projectId,
    });
  });
}

/**
 * Decrypts a project's repository token for the worker.
 *
 * @param database - Database.
 * @param secretBox - Encryption box.
 * @param projectId - Project id.
 * @returns The token, or null when none is stored.
 */
export async function readRepositoryToken(
  database: Database,
  secretBox: SecretBox,
  projectId: string,
): Promise<string | null> {
  const row = database
    .select({ encrypted: tables.projects.encryptedRepositoryToken })
    .from(tables.projects)
    .where(eq(tables.projects.id, projectId))
    .get();
  if (row?.encrypted == null) {
    return null;
  }
  return await secretBox.decrypt(row.encrypted, repositoryTokenContext(projectId));
}

function findActiveProjectRow(database: Database | Transaction, projectId: string) {
  const row = database
    .select({
      slug: tables.projects.slug,
      repositoryFullName: tables.projects.repositoryFullName,
      deploymentsApproved: tables.projects.deploymentsApproved,
    })
    .from(tables.projects)
    .where(and(eq(tables.projects.id, projectId), isNull(tables.projects.deletionRequestedAt)))
    .get();
  if (row == null) {
    throw new ProjectNotFoundError(projectId);
  }
  return row;
}

/**
 * Reads a project that is not being deleted.
 *
 * @param database - Database or open transaction.
 * @param projectId - Project id.
 * @returns The project.
 * @throws {ProjectNotFoundError} When the project does not exist or is being deleted.
 */
export function getProject(database: Database | Transaction, projectId: string): Project {
  const project = database
    .select(projectColumns)
    .from(tables.projects)
    .where(and(eq(tables.projects.id, projectId), isNull(tables.projects.deletionRequestedAt)))
    .get();
  if (project == null) {
    throw new ProjectNotFoundError(projectId);
  }
  return project;
}

/**
 * Finds a project by id or slug, for tools that accept either.
 *
 * @param database - Database.
 * @param idOrSlug - Project id or slug.
 * @returns The project.
 * @throws {ProjectNotFoundError} When neither matches.
 */
export function findProject(database: Database, idOrSlug: string): Project {
  const project = database
    .select(projectColumns)
    .from(tables.projects)
    .where(
      and(
        or(eq(tables.projects.id, idOrSlug), eq(tables.projects.slug, idOrSlug)),
        isNull(tables.projects.deletionRequestedAt),
      ),
    )
    .get();
  if (project == null) {
    throw new ProjectNotFoundError(idOrSlug);
  }
  return project;
}

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
  const search = (options.search ?? "").trim().slice(0, MAX_SEARCH_LENGTH);
  const pattern = `%${search.replaceAll(/[%_\\]/g, (character) => `\\${character}`)}%`;
  const searchCondition =
    search === ""
      ? undefined
      : or(
          sql`${tables.projects.name} LIKE ${pattern} ESCAPE '\\'`,
          sql`${tables.projects.slug} LIKE ${pattern} ESCAPE '\\'`,
          like(tables.projects.repositoryFullName, pattern),
        );
  const projects = database
    .select(projectColumns)
    .from(tables.projects)
    .where(and(isNull(tables.projects.deletionRequestedAt), searchCondition))
    .orderBy(asc(tables.projects.name))
    .all();
  if (projects.length === 0) {
    return [];
  }
  const projectIds = projects.map((project) => project.id);
  const latestDeployments = database
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
  const latestByProject = new Map(
    latestDeployments.map((deployment) => [deployment.projectId, deployment]),
  );
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
  const snapshotByDeployment = new Map(
    snapshots
      .toReversed()
      .map((snapshot) => [`${snapshot.projectId}:${snapshot.deploymentId}`, snapshot]),
  );
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
