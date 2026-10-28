import { createFileRoute } from "@tanstack/react-router";

import { getCurrentUser } from "@/auth";
import { getDatabase } from "@/db";
import { getDeployment, isTerminalStatus } from "@/deployments";
import { createLogger } from "@/logging";
import { listDeploymentLogs } from "@/logs";
import { createEventStreamResponse } from "@/web/server/event-stream";

const BATCH_SIZE = 500;

export const Route = createFileRoute("/api/deployments/$deploymentId/logs")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const user = await getCurrentUser(request.headers);
        if (user == null) {
          return new Response("Unauthorized", { status: 401 });
        }
        const database = getDatabase();
        try {
          getDeployment(database, params.deploymentId);
        } catch {
          return new Response("Not found", { status: 404 });
        }
        return createEventStreamResponse(
          request,
          (afterId) => {
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
