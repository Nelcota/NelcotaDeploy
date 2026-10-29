import { lookup } from "node:dns/promises";

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { userActor } from "@/auth";
import { getConfig } from "@/config";
import { getDatabase } from "@/db";
import { addDomain, removeDomain, resolvePublicAddress } from "@/domains";
import { domainInputSchema } from "@/shared/schemas/domain.schema";
import { authorize } from "@/web/server/authorization";

import { idSchema } from "./ids";

const LOOKUP_TIMEOUT_IN_MS = 3000;

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

/** Resolves a hostname, giving up after a few seconds so a slow DNS never hangs the page. */
async function lookupWithTimeout(hostname: string): Promise<{ readonly address: string }> {
  const { promise, reject } = Promise.withResolvers<never>();
  const timer = setTimeout(
    () => reject(new Error(`DNS lookup of ${hostname} timed out`)),
    LOOKUP_TIMEOUT_IN_MS,
  );
  using _timer = { [Symbol.dispose]: () => clearTimeout(timer) };
  return await Promise.race([lookup(hostname), promise]);
}

/** Public IP address of this server, for the DNS record a custom domain needs; null if unknown. */
export const getServerAddressFn = createServerFn({ method: "GET" }).handler(async () => {
  await authorize("project:read");
  return await resolvePublicAddress(getConfig().PUBLIC_URL, lookupWithTimeout);
});
