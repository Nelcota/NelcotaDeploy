import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { getDatabase } from "@/db";
import { listProjectSamples } from "@/monitoring";
import { getProject } from "@/projects";
import { authorize } from "@/web/server/authorization";

import { idSchema } from "./ids";

const MILLISECONDS_PER_HOUR = 3_600_000;
const MAX_HOURS = 48;

export const getProjectMetricsFn = createServerFn({ method: "GET" })
  .validator(z.object({ projectId: idSchema, hours: z.number().int().min(1).max(MAX_HOURS) }))
  .handler(async ({ data }) => {
    await authorize("project:read");
    const database = getDatabase();
    getProject(database, data.projectId);
    return listProjectSamples(
      database,
      data.projectId,
      new Date(Date.now() - data.hours * MILLISECONDS_PER_HOUR),
    );
  });
