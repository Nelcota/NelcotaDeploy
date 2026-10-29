import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { getDatabase } from "@/db";
import { countActiveDeployments } from "@/deployments";
import { getDashboardSummary, getWorkerStatus, listHostSamples } from "@/monitoring";
import { authorize } from "@/web/server/authorization";

import { idSchema } from "./ids";

const MILLISECONDS_PER_HOUR = 3_600_000;
const MAX_HOURS = 48;

export const getDashboardFn = createServerFn({ method: "GET" }).handler(async () => {
  await authorize("project:read");
  return getDashboardSummary(getDatabase());
});

export const getHostMetricsFn = createServerFn({ method: "GET" })
  .validator(z.object({ serverId: idSchema, hours: z.number().int().min(1).max(MAX_HOURS) }))
  .handler(async ({ data }) => {
    await authorize("project:read");
    return listHostSamples(
      getDatabase(),
      data.serverId,
      new Date(Date.now() - data.hours * MILLISECONDS_PER_HOUR),
    );
  });

/** Worker liveness, Docker availability and running deployments, polled by the sidebar. */
export const getSidebarStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  await authorize("project:read");
  const database = getDatabase();
  return { worker: getWorkerStatus(database), activeDeployments: countActiveDeployments(database) };
});
