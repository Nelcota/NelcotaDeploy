import { createServerFn } from "@tanstack/react-start";
import ipaddr from "ipaddr.js";
import { z } from "zod";

import { getConfig } from "@/config";
import { getDatabase } from "@/db";
import {
  checkDomainsDns,
  isPublicIpAddress,
  listProjectDomains,
  projectServerAddress,
} from "@/domains";
import { getSystemSettings } from "@/settings";
import { authorizeProject } from "@/web/server/authorization";

import { idSchema } from "../ids";

/**
 * Public address and matching DNS record type of the server a project runs on, or null when
 * unknown.
 */
export const getServerAddressFn = createServerFn({ method: "GET" })
  .validator(z.object({ projectId: idSchema }))
  .handler(async ({ data }) => {
    await authorizeProject("project:read", data.projectId);
    const address = await projectServerAddress(
      getDatabase(),
      data.projectId,
      getConfig().PUBLIC_URL,
    );
    if (address == null || isPublicIpAddress(address) === false) {
      return null;
    }

    const publicAddress = ipaddr.process(address);
    return {
      address: publicAddress.toString(),
      type: publicAddress.kind() === "ipv6" ? "AAAA" : "A",
    } as const;
  });

/** Where each domain of a project points, checked against the project's server address. */
export const getDomainsDnsFn = createServerFn({ method: "GET" })
  .validator(z.object({ projectId: idSchema }))
  .handler(async ({ data }) => {
    await authorizeProject("project:read", data.projectId);
    const database = getDatabase();
    const domains = listProjectDomains(
      database,
      data.projectId,
      getSystemSettings(database, { includeSecrets: false }),
    );
    const expected = await projectServerAddress(database, data.projectId, getConfig().PUBLIC_URL);
    return await checkDomainsDns(
      domains.map((domain) => domain.hostname),
      expected,
    );
  });
