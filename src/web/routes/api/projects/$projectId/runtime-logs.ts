import { createFileRoute } from "@tanstack/react-router";

import { assertProjectPermission } from "@/access";
import { getDatabase } from "@/db";
import { createLogger } from "@/logging";
import { listRuntimeLogs } from "@/logs";
import { accessErrorResponse, authorizeHeaders } from "@/web/server/authorization";
import { createEventStreamResponse, readCursor } from "@/web/server/event-stream";

const BATCH_SIZE = 500;
const INITIAL_HISTORY_LINES = 500;

export const Route = createFileRoute("/api/projects/$projectId/runtime-logs")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const database = getDatabase();
        try {
          const user = await authorizeHeaders(request.headers, "project:read");
          // Non-members get the same answer as for a missing project.
          assertProjectPermission(database, user, {
            projectId: params.projectId,
            permission: "project:read",
          });
        } catch (error) {
          return accessErrorResponse(error);
        }
        const deploymentId = new URL(request.url).searchParams.get("deploymentId") ?? undefined;
        const firstConnection = readCursor(request) === 0;
        return createEventStreamResponse(
          request,
          async (afterId) => {
            // Checked on every read, so removing a member ends their open stream.
            const reader = await authorizeHeaders(request.headers, "project:read");
            assertProjectPermission(database, reader, {
              projectId: params.projectId,
              permission: "project:read",
            });
            // The first read sends recent history; later reads send only new lines.
            const items =
              firstConnection && afterId === 0
                ? listRuntimeLogs(database, params.projectId, {
                    limit: INITIAL_HISTORY_LINES,
                    deploymentId,
                  })
                : listRuntimeLogs(database, params.projectId, {
                    afterId,
                    limit: BATCH_SIZE,
                    deploymentId,
                  });
            return { items, finished: false };
          },
          (error) => createLogger("web").error({ err: error }, "runtime log stream failed"),
        );
      },
    },
  },
});
