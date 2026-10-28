import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { userActor } from "@/auth";
import { getDatabase } from "@/db";
import { addDomain, removeDomain } from "@/domains";
import { domainInputSchema } from "@/shared/domain.schema";
import { authorize } from "@/web/server/authorization";

import { idSchema } from "./ids";

export const addDomainFn = createServerFn({ method: "POST" })
  .validator(z.object({ projectId: idSchema, domain: domainInputSchema }))
  .handler(async ({ data }) => {
    const user = await authorize("domain:write");
    addDomain(getDatabase(), data.projectId, data.domain, userActor(user));
  });

export const removeDomainFn = createServerFn({ method: "POST" })
  .validator(z.object({ projectId: idSchema, domainId: idSchema }))
  .handler(async ({ data }) => {
    const user = await authorize("domain:write");
    removeDomain(getDatabase(), data.projectId, data.domainId, userActor(user));
  });
