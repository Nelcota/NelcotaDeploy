import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { userActor } from "@/auth";
import { getDatabase } from "@/db";
import { applyRuntimeChanges } from "@/deployments";
import { addDomain, removeDomain } from "@/domains";
import { domainInputSchema } from "@/shared/schemas/domain.schema";
import { authorize } from "@/web/server/authorization";

import { idSchema } from "./ids";

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
