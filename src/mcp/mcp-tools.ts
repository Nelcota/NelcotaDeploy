import { z } from "zod";

import type { Actor } from "@/audit";
import { type ApiTokenScope, verifyApiToken } from "@/auth";
import type { Database } from "@/db";
import {
  getDeployment,
  listDeployments,
  requestContainerAction,
  requestDeployment,
} from "@/deployments";
import { listProjectDomains } from "@/domains";
import { isCommitSha } from "@/git";
import { listDeploymentLogs } from "@/logs";
import {
  getLatestHostSample,
  getWorkerStatus,
  listProjectContainers,
  listProjectSamples,
} from "@/monitoring";
import { findProject, listProjects } from "@/projects";
import { getSystemSettings } from "@/settings";

const MILLISECONDS_PER_HOUR = 3_600_000;
const MAX_METRIC_HOURS = 48;
const MAX_DEPLOYMENTS = 50;
const MAX_LOG_LINES = 1000;
const DEFAULT_DEPLOYMENTS = 10;
const DEFAULT_LOG_LINES = 300;

/** Thrown when the MCP token is invalid, revoked, expired or lacks a scope. */
class McpAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpAuthorizationError";
  }
}

/** Shared state of every tool call. */
export type McpToolContext = {
  readonly database: Database;
  /** Plaintext token from the MCP process environment, re-verified on every call. */
  readonly token: string;
};

function authorize(context: McpToolContext, scope: ApiTokenScope): Actor {
  const token = verifyApiToken(context.database, context.token);
  if (token == null) {
    throw new McpAuthorizationError("The MCP token is invalid, revoked or expired");
  }
  if (token.scopes.includes(scope) === false) {
    throw new McpAuthorizationError(`The MCP token lacks the "${scope}" scope`);
  }
  return { type: "token", id: token.id, label: `token:${token.name}` };
}

const projectReference = z.string().trim().min(1).max(100).describe("Project id or slug");

/** Input schemas of every tool, also used for validation. */
export const toolSchemas = {
  listProjects: z.object({
    search: z.string().max(100).optional().describe("Filter by name, slug or repository"),
  }),
  getProject: z.object({ project: projectReference }),
  listDeployments: z.object({
    project: projectReference.optional(),
    limit: z.number().int().min(1).max(MAX_DEPLOYMENTS).default(DEFAULT_DEPLOYMENTS),
  }),
  getDeployment: z.object({ deploymentId: z.string().trim().min(1).max(100) }),
  getDeploymentLogs: z.object({
    deploymentId: z.string().trim().min(1).max(100),
    afterId: z.number().int().min(0).default(0).describe("Return lines after this log id"),
    limit: z.number().int().min(1).max(MAX_LOG_LINES).default(DEFAULT_LOG_LINES),
  }),
  getProjectMetrics: z.object({
    project: projectReference,
    hours: z.number().int().min(1).max(MAX_METRIC_HOURS).default(1),
  }),
  getContainerStatus: z.object({ project: projectReference }),
  deployProject: z.object({
    project: projectReference,
    commitSha: z
      .string()
      .trim()
      .refine(isCommitSha, { message: "must be a 7-40 character lowercase hex SHA" })
      .optional()
      .describe("Exact commit; defaults to the branch head"),
  }),
  restartProject: z.object({ project: projectReference }),
};

/**
 * Tool implementations. Each authorizes the token on every call, so revoking a token
 * takes effect immediately.
 */
export const tools = {
  listProjects(context: McpToolContext, input: z.infer<typeof toolSchemas.listProjects>) {
    authorize(context, "read");
    return listProjects(context.database, { search: input.search ?? "" }).map((project) => ({
      id: project.id,
      name: project.name,
      slug: project.slug,
      repository: project.repositoryFullName,
      branch: project.branch,
      autoDeploy: project.autoDeploy,
      containerState: project.containerState,
      latestDeployment: project.latestDeployment,
    }));
  },

  getProject(context: McpToolContext, input: z.infer<typeof toolSchemas.getProject>) {
    authorize(context, "read");
    const project = findProject(context.database, input.project);
    return {
      ...project,
      domains: listProjectDomains(
        context.database,
        project.id,
        getSystemSettings(context.database),
      ),
      containers: listProjectContainers(context.database, project.id),
    };
  },

  listDeployments(context: McpToolContext, input: z.infer<typeof toolSchemas.listDeployments>) {
    authorize(context, "read");
    const projectId =
      input.project == null ? undefined : findProject(context.database, input.project).id;
    return listDeployments(context.database, { projectId, limit: input.limit });
  },

  getDeployment(context: McpToolContext, input: z.infer<typeof toolSchemas.getDeployment>) {
    authorize(context, "read");
    return getDeployment(context.database, input.deploymentId);
  },

  getDeploymentLogs(context: McpToolContext, input: z.infer<typeof toolSchemas.getDeploymentLogs>) {
    authorize(context, "read");
    const deployment = getDeployment(context.database, input.deploymentId);
    const lines = listDeploymentLogs(context.database, deployment.id, {
      afterId: input.afterId,
      limit: input.limit,
    });
    return { status: deployment.status, lines };
  },

  getProjectMetrics(context: McpToolContext, input: z.infer<typeof toolSchemas.getProjectMetrics>) {
    authorize(context, "read");
    const project = findProject(context.database, input.project);
    const since = new Date(Date.now() - input.hours * MILLISECONDS_PER_HOUR);
    return {
      project: project.slug,
      containerSamples: listProjectSamples(context.database, project.id, since),
      latestHostSample: getLatestHostSample(context.database),
      note: "Null values mean the metric could not be collected.",
    };
  },

  getContainerStatus(
    context: McpToolContext,
    input: z.infer<typeof toolSchemas.getContainerStatus>,
  ) {
    authorize(context, "read");
    const project = findProject(context.database, input.project);
    return {
      project: project.slug,
      currentDeploymentId: project.currentDeploymentId,
      containers: listProjectContainers(context.database, project.id),
      worker: getWorkerStatus(context.database),
    };
  },

  deployProject(context: McpToolContext, input: z.infer<typeof toolSchemas.deployProject>) {
    const actor = authorize(context, "deploy");
    const project = findProject(context.database, input.project);
    return requestDeployment(context.database, {
      projectId: project.id,
      trigger: "mcp",
      actor,
      triggeredByUserId: null,
      commitSha: input.commitSha ?? null,
    });
  },

  restartProject(context: McpToolContext, input: z.infer<typeof toolSchemas.restartProject>) {
    const actor = authorize(context, "deploy");
    const project = findProject(context.database, input.project);
    return requestContainerAction(context.database, {
      projectId: project.id,
      action: "restart",
      actor,
    });
  },
};
