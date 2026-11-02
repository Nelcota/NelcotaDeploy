import { and, eq } from "drizzle-orm";

import type { Actor } from "@/audit";
import { listProjectDatabases } from "@/databases";
import { type Database, tables } from "@/db";
import { getDeployment, requestDeployment } from "@/deployments";
import { prepareEnvironmentVariable, readVariablesForCopy } from "@/environments";
import {
  createProject,
  getProject,
  type Project,
  readRepositoryToken,
  requestProjectDeletion,
  setRepositoryToken,
} from "@/projects";
import type { SecretBox } from "@/secrets";
import { isValidBranchName, MAX_SLUG_LENGTH } from "@/shared/schemas/project.schema";

import {
  InvalidStagingBranchError,
  NotAProductionProjectError,
  NotAStagingEnvironmentError,
  NothingToPromoteError,
  PromotionRepositoryMismatchError,
  StagingAlreadyExistsError,
  StagingDeploymentChangedError,
} from "./staging.errors";

const STAGING = "staging";
const SLUG_SUFFIX = `-${STAGING}`;

type Creator = { readonly actor: Actor; readonly userId: string | null; readonly isAdmin: boolean };

/**
 * Returns the staging environment of a production project.
 *
 * @param database - Database.
 * @param productionProjectId - Production project.
 * @returns Its staging project, or null when it has none (or it is being deleted).
 */
export function findStagingProject(
  database: Database,
  productionProjectId: string,
): Project | null {
  const row = database
    .select({ id: tables.projects.id, deletionRequestedAt: tables.projects.deletionRequestedAt })
    .from(tables.projects)
    .where(
      and(
        eq(tables.projects.parentProjectId, productionProjectId),
        eq(tables.projects.environmentName, STAGING),
      ),
    )
    .get();
  if (row == null || row.deletionRequestedAt != null) {
    return null;
  }
  return getProject(database, row.id);
}

function stagingSlug(productionSlug: string): string {
  const base = productionSlug.slice(0, MAX_SLUG_LENGTH - SLUG_SUFFIX.length).replace(/-+$/, "");
  return `${base}${SLUG_SUFFIX}`;
}

function assertNoStaging(database: Database, productionProjectId: string): void {
  // A staging environment still being deleted keeps its row, and its name, until cleaned up.
  const existing = database
    .select({ id: tables.projects.id })
    .from(tables.projects)
    .where(
      and(
        eq(tables.projects.parentProjectId, productionProjectId),
        eq(tables.projects.environmentName, STAGING),
      ),
    )
    .get();
  if (existing != null) {
    throw new StagingAlreadyExistsError(productionProjectId);
  }
}

/**
 * Creates the staging environment of a production project: a project of its own, built from
 * the same repository and settings, that deploys another branch.
 *
 * @remarks
 * With `copyVariables`, the production variables are copied, secrets included, except the
 * connection URLs of production's managed databases: staging must never reach them. The
 * private repository token is copied too, so staging can clone the same repository.
 *
 * @param database - Database.
 * @param secretBox - Encryption box, to copy secrets and the repository token.
 * @param request - Production project, staging `branch`, whether to `copyVariables` and who
 *   creates it.
 * @returns The staging project.
 * @throws {ProjectNotFoundError} When the production project does not exist.
 * @throws {NotAProductionProjectError} When the project is itself an environment.
 * @throws {StagingAlreadyExistsError} When it already has a staging environment.
 * @throws {InvalidStagingBranchError} When the branch name is invalid.
 * @throws {ProjectSlugTakenError} When another project already uses the staging identifier.
 */
export async function createStagingEnvironment(
  database: Database,
  secretBox: SecretBox,
  request: {
    readonly productionProjectId: string;
    readonly branch: string;
    readonly copyVariables: boolean;
    readonly creator: Creator;
  },
): Promise<Project> {
  const { productionProjectId, creator } = request;
  const production = getProject(database, productionProjectId);
  if (production.parentProjectId != null) {
    throw new NotAProductionProjectError(productionProjectId);
  }
  const branch = request.branch.trim();
  if (isValidBranchName(branch) === false) {
    throw new InvalidStagingBranchError(branch);
  }
  assertNoStaging(database, productionProjectId);
  const staging = createPendingStagingProject(database, { production, branch, creator });
  try {
    await copyFromProduction(database, secretBox, {
      production,
      stagingProjectId: staging.id,
      copyVariables: request.copyVariables,
      actor: creator.actor,
    });
    database.transaction((transaction) => {
      getProject(transaction, productionProjectId);
      getProject(transaction, staging.id);
      transaction
        .update(tables.projects)
        .set({ autoDeploy: true, deploymentsApproved: creator.isAdmin })
        .where(eq(tables.projects.id, staging.id))
        .run();
    });
  } catch (error) {
    // A staging environment without its settings would deploy with the wrong values.
    requestProjectDeletion(database, staging.id, creator.actor);
    throw error;
  }
  return getProject(database, staging.id);
}

function createPendingStagingProject(
  database: Database,
  {
    production,
    branch,
    creator,
  }: {
    readonly production: Project;
    readonly branch: string;
    readonly creator: Creator;
  },
): Project {
  return createProject(
    database,
    {
      name: `${production.name} (staging)`,
      slug: stagingSlug(production.slug),
      repositoryUrl: production.repositoryUrl,
      branch,
      builder: production.builder,
      dockerfilePath: production.dockerfilePath,
      buildContext: production.buildContext,
      internalPort: production.internalPortAuto ? null : production.internalPort,
      healthCheckPath: production.healthCheckPath,
      autoDeploy: false,
      autoApplyChanges: production.autoApplyChanges,
      previewsEnabled: false,
      memoryLimitInMb: production.memoryLimitInMb,
      cpuLimitInMillicores: production.cpuLimitInMillicores,
    },
    {
      ...creator,
      // Copying yields to encryption; no deployment may start with partial configuration.
      isAdmin: false,
      environment: { parentProjectId: production.id, environmentName: STAGING },
    },
  );
}

async function copyFromProduction(
  database: Database,
  secretBox: SecretBox,
  copy: {
    readonly production: Project;
    readonly stagingProjectId: string;
    readonly copyVariables: boolean;
    readonly actor: Actor;
  },
): Promise<void> {
  const { production, stagingProjectId, actor } = copy;
  const token = await readRepositoryToken(database, secretBox, production.id);
  if (token != null) {
    await setRepositoryToken(database, secretBox, { projectId: stagingProjectId, token, actor });
  }
  if (copy.copyVariables === false) {
    return;
  }
  const managedDatabases = listProjectDatabases(database, production.id);
  const databaseKeys = new Set(managedDatabases.map((managed) => managed.environmentKey));
  const databaseHosts = new Set(managedDatabases.map((managed) => managed.host.toLowerCase()));
  const variables = (await readVariablesForCopy(database, secretBox, production.id)).filter(
    (variable) =>
      databaseKeys.has(variable.key) === false &&
      targetsProductionDatabase(variable.value, databaseHosts) === false,
  );
  const writers = await Promise.all(
    variables.map(
      async (input) =>
        await prepareEnvironmentVariable(database, secretBox, {
          projectId: stagingProjectId,
          input,
          actor,
        }),
    ),
  );
  database.transaction((transaction) => {
    for (const write of writers) {
      write(transaction);
    }
  });
}

function targetsProductionDatabase(value: string, databaseHosts: ReadonlySet<string>): boolean {
  const trimmed = value.trim();
  if (trimmed === "" || URL.canParse(trimmed) === false) {
    return false;
  }
  return databaseHosts.has(new URL(trimmed).hostname.toLowerCase());
}

/**
 * Deploys to production the commit that is live on its staging environment. Production builds
 * it again with its own build variables, which often differ from staging's.
 *
 * @param database - Database.
 * @param request - Staging project, the deployment confirmed by the user and who promotes.
 * @returns The id of the production deployment.
 * @throws {ProjectNotFoundError} When the staging project does not exist.
 * @throws {NotAStagingEnvironmentError} When the project is not a staging environment.
 * @throws {NothingToPromoteError} When staging has no live deployment with a commit.
 * @throws {StagingDeploymentChangedError} When the confirmed deployment is no longer live.
 * @throws {PromotionRepositoryMismatchError} When staging builds another repository.
 * @throws {ProjectNotApprovedError} When production still awaits approval.
 */
export function promoteStagingToProduction(
  database: Database,
  request: {
    readonly stagingProjectId: string;
    readonly expectedDeploymentId: string;
    readonly actor: Actor;
    readonly triggeredByUserId: string | null;
  },
): { readonly deploymentId: string } {
  const staging = getProject(database, request.stagingProjectId);
  if (staging.parentProjectId == null || staging.environmentName !== STAGING) {
    throw new NotAStagingEnvironmentError(staging.id);
  }
  const live =
    staging.currentDeploymentId == null
      ? null
      : getDeployment(database, staging.currentDeploymentId);
  if (live?.commitSha == null) {
    throw new NothingToPromoteError(staging.id);
  }
  if (live.id !== request.expectedDeploymentId) {
    throw new StagingDeploymentChangedError(staging.id);
  }
  const production = getProject(database, staging.parentProjectId);
  if (production.repositoryFullName !== staging.repositoryFullName) {
    throw new PromotionRepositoryMismatchError(
      staging.repositoryFullName,
      production.repositoryFullName,
    );
  }
  const { deploymentId } = requestDeployment(database, {
    projectId: production.id,
    trigger: "promote",
    actor: request.actor,
    triggeredByUserId: request.triggeredByUserId,
    commitSha: live.commitSha,
    commitMessage: live.commitMessage,
  });
  return { deploymentId };
}
