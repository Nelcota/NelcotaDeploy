import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { userActor } from "@/auth";
import { getDatabase } from "@/db";
import { applyRuntimeChanges } from "@/deployments";
import { addDomain, removeDomain } from "@/domains";
import { getProject } from "@/projects";
import { domainInputSchema } from "@/shared/schemas/domain.schema";
import { listUptimeSummaries } from "@/uptime";
import { authorize } from "@/web/server/authorization";

import { idSchema, projectIdInput } from "./ids";

/** How each domain of a project answered visitors recently, and its certificate's expiry. */
export const getDomainUptimeFn = createServerFn({ method: "GET" })
  .validator(projectIdInput)
  .handler(async ({ data }) => {
    await authorize("project:read");
    const database = getDatabase();
    getProject(database, data.projectId);
    return listUptimeSummaries(database, data.projectId, new Date());
  });

export const addDomainFn = createServerFn({ method: "POST" })
  .validator(z.object({ projectId: idSchema, domain: domainInputSchema }))
  .handler(async ({ data }) => {
    const user = await authorize("domain:write");
    const database = getDatabase();
    addDomain(database, {
      projectId: data.projectId,
      input: data.domain,
      actor: userActor(user),
    });
    applyRuntimeChanges(database, data.projectId, {
      actor: userActor(user),
      triggeredByUserId: user.id,
    });
  });

export const removeDomainFn = createServerFn({ method: "POST" })
  .validator(z.object({ projectId: idSchema, domainId: idSchema }))
  .handler(async ({ data }) => {
    const user = await authorize("domain:write");
    const database = getDatabase();
    removeDomain(database, {
      projectId: data.projectId,
      domainId: data.domainId,
      actor: userActor(user),
    });
    applyRuntimeChanges(database, data.projectId, {
      actor: userActor(user),
      triggeredByUserId: user.id,
    });
  });
