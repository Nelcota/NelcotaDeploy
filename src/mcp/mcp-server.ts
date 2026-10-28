import { type CallToolResult, McpServer } from "@modelcontextprotocol/server";

import { type McpToolContext, tools, toolSchemas } from "./mcp-tools";

function result(run: () => unknown): CallToolResult {
  try {
    return { content: [{ type: "text", text: JSON.stringify(run(), null, 2) }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { isError: true, content: [{ type: "text", text: message }] };
  }
}

const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const mutating = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/**
 * Builds the MCP server exposing platform tools. There is deliberately no tool that runs
 * arbitrary commands on the host.
 *
 * @param context - Database and token used by every tool call.
 * @returns The server, ready to connect to a transport.
 */
export function createMcpServer(context: McpToolContext): McpServer {
  const server = new McpServer({ name: "nelcota-deploy", version: "1.0.0" });

  server.registerTool(
    "list_projects",
    {
      description: "List projects with their latest deployment and container state.",
      inputSchema: toolSchemas.listProjects,
      annotations: readOnly,
    },
    (input) => result(() => tools.listProjects(context, input)),
  );
  server.registerTool(
    "get_project",
    {
      description: "Get a project's configuration, domains and containers.",
      inputSchema: toolSchemas.getProject,
      annotations: readOnly,
    },
    (input) => result(() => tools.getProject(context, input)),
  );
  server.registerTool(
    "list_deployments",
    {
      description: "List recent deployments, optionally for one project.",
      inputSchema: toolSchemas.listDeployments,
      annotations: readOnly,
    },
    (input) => result(() => tools.listDeployments(context, input)),
  );
  server.registerTool(
    "get_deployment",
    {
      description: "Get a deployment's status, commit, image and error.",
      inputSchema: toolSchemas.getDeployment,
      annotations: readOnly,
    },
    (input) => result(() => tools.getDeployment(context, input)),
  );
  server.registerTool(
    "get_deployment_logs",
    {
      description: "Read build and startup logs of a deployment (secrets are redacted).",
      inputSchema: toolSchemas.getDeploymentLogs,
      annotations: readOnly,
    },
    (input) => result(() => tools.getDeploymentLogs(context, input)),
  );
  server.registerTool(
    "get_project_metrics",
    {
      description:
        "Get CPU and memory samples of a project's container and the latest host sample.",
      inputSchema: toolSchemas.getProjectMetrics,
      annotations: readOnly,
    },
    (input) => result(() => tools.getProjectMetrics(context, input)),
  );
  server.registerTool(
    "get_container_status",
    {
      description: "Get the containers of a project as last observed by the worker.",
      inputSchema: toolSchemas.getContainerStatus,
      annotations: readOnly,
    },
    (input) => result(() => tools.getContainerStatus(context, input)),
  );
  server.registerTool(
    "deploy_project",
    {
      description:
        "Queue a deployment of a project (branch head or an exact commit). Requires the deploy scope.",
      inputSchema: toolSchemas.deployProject,
      annotations: mutating,
    },
    (input) => result(() => tools.deployProject(context, input)),
  );
  server.registerTool(
    "restart_project",
    {
      description: "Queue a restart of a project's current container. Requires the deploy scope.",
      inputSchema: toolSchemas.restartProject,
      annotations: mutating,
    },
    (input) => result(() => tools.restartProject(context, input)),
  );
  return server;
}
