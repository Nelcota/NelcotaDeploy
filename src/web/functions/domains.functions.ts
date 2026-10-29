import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { userActor } from "@/auth";
import { getDatabase } from "@/db";
import { addDomain, removeDomain } from "@/domains";
import { domainInputSchema } from "@/shared/schemas/domain.schema";
import { authorize } from "@/web/server/authorization";

import { idSchema } from "./ids";

export const addDomainFn = createServerFn({ method: "POST" })
  .validator(z.object({ projectId: idSchema, domain: domainInputSchema }))
  .handler(async ({ data }) => {
    const user = await authorize("domain:write");
    addDomain(getDatabase(), {
      projectId: data.projectId,
      input: data.domain,
      actor: userActor(user),
    });
  });

export const removeDomainFn = createServerFn({ method: "POST" })
  .validator(z.object({ projectId: idSchema, domainId: idSchema }))
  .handler(async ({ data }) => {
    const user = await authorize("domain:write");
    removeDomain(getDatabase(), {
      projectId: data.projectId,
      domainId: data.domainId,
      actor: userActor(user),
    });
  });
