import { createFileRoute } from "@tanstack/react-router";
import { sql } from "drizzle-orm";

import { getDatabase } from "@/db";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: () => {
        try {
          getDatabase().run(sql`SELECT 1`);
          return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
        } catch {
          return Response.json({ status: "database_unavailable" }, { status: 503 });
        }
      },
    },
  },
});
