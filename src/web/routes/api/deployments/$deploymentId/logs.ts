import { createFileRoute } from "@tanstack/react-router";

import { assertProjectPermission } from "@/access";
import { getDatabase } from "@/db";
import { getDeployment, isTerminalStatus } from "@/deployments";
import { createLogger } from "@/logging";
import { listDeploymentLogs } from "@/logs";
import { accessErrorResponse, authorizeHeaders } from "@/web/server/authorization";
import { createEventStreamResponse } from "@/web/server/event-stream";

const BATCH_SIZE = 500;

export const Route = createFileRoute("/api/deployments/$deploymentId/logs")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const database = getDatabase();
        let projectId: string;
        try {
          const user = await authorizeHeaders(request.headers, "project:read");
          projectId = getDeployment(database, params.deploymentId).projectId;
          // Non-members get the same answer as for a missing deployment.
          assertProjectPermission(database, user, {
            projectId,
            permission: "project:read",
          });
        } catch (error) {
          return accessErrorResponse(error);
        }
        return createEventStreamResponse(
          request,
          async (afterId) => {
            // Checked on every read, so removing a member ends their open stream.
            const reader = await authorizeHeaders(request.headers, "project:read");
            assertProjectPermission(database, reader, {
              projectId,
              permission: "project:read",
            });
            const deployment = getDeployment(database, params.deploymentId);
            const items = listDeploymentLogs(database, params.deploymentId, {
              afterId,
              limit: BATCH_SIZE,
            });
            return {
              items,
              finished: isTerminalStatus(deployment.status),
              summary: { status: deployment.status },
            };
          },
          (error) => createLogger("web").error({ err: error }, "deployment log stream failed"),
        );
      },
    },
  },
});
