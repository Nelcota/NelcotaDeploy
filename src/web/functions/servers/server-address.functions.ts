import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { getConfig } from "@/config";
import { getDatabase } from "@/db";
import { checkDomainsDns, listProjectDomains, projectServerAddress } from "@/domains";
import { getSystemSettings } from "@/settings";
import { authorize } from "@/web/server/authorization";

import { idSchema } from "../ids";

/**
 * Public IP address of the server a project runs on, for the DNS record a custom domain
 * needs; null if unknown. The worker detects it for servers reached over SSH; the panel's own
 * host is found from PUBLIC_URL.
 */
export const getServerAddressFn = createServerFn({ method: "GET" })
  .validator(z.object({ projectId: idSchema }))
  .handler(async ({ data }) => {
    await authorize("project:read");
    return await projectServerAddress(getDatabase(), data.projectId, getConfig().PUBLIC_URL);
  });

/** Where each domain of a project points, checked against the project's server address. */
export const getDomainsDnsFn = createServerFn({ method: "GET" })
  .validator(z.object({ projectId: idSchema }))
  .handler(async ({ data }) => {
    await authorize("project:read");
    const database = getDatabase();
    const domains = listProjectDomains(database, data.projectId, getSystemSettings(database));
    const expected = await projectServerAddress(database, data.projectId, getConfig().PUBLIC_URL);
    return await checkDomainsDns(
      domains.map((domain) => domain.hostname),
      expected,
    );
  });
