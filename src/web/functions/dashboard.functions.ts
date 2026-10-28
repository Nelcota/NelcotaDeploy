import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { getDatabase } from "@/db";
import { getDashboardSummary, getWorkerStatus, listHostSamples } from "@/monitoring";
import { authorize } from "@/web/server/authorization";

const MILLISECONDS_PER_HOUR = 3_600_000;
const MAX_HOURS = 48;

export const getDashboardFn = createServerFn({ method: "GET" }).handler(async () => {
  await authorize("project:read");
  return getDashboardSummary(getDatabase());
});

export const getHostMetricsFn = createServerFn({ method: "GET" })
  .validator(z.object({ hours: z.number().int().min(1).max(MAX_HOURS) }))
  .handler(async ({ data }) => {
    await authorize("project:read");
    return listHostSamples(
      getDatabase(),
      new Date(Date.now() - data.hours * MILLISECONDS_PER_HOUR),
    );
  });

/** Worker liveness and Docker availability, polled by the sidebar footer. */
export const getWorkerStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  await authorize("project:read");
  return getWorkerStatus(getDatabase());
});
