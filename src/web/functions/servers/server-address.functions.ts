import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { getConfig } from "@/config";
import { getDatabase } from "@/db";
import { lookupWithTimeout, resolvePublicAddress } from "@/domains";
import { getProject } from "@/projects";
import { getServer } from "@/servers";
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
    const database = getDatabase();
    const server = getServer(database, getProject(database, data.projectId).serverId);
    if (server.kind === "ssh") {
      return server.publicAddress;
    }
    return await resolvePublicAddress(getConfig().PUBLIC_URL, lookupWithTimeout);
  });
