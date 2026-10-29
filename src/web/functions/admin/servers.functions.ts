import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { userActor } from "@/auth";
import { getDatabase } from "@/db";
import { listLatestHostSamples } from "@/monitoring";
import {
  addServer,
  buildInstallCommand,
  getPanelPublicKey,
  listServers,
  removeServer,
  type Server,
  setServerAcceptsApplications,
} from "@/servers";
import { serverInputSchema } from "@/shared/schemas/server.schema";
import { authorize } from "@/web/server/authorization";

import { idSchema } from "../ids";

/** Command to prepare a server, while it still needs it; null once the panel reached it. */
function installCommandFor(server: Server, publicKey: string | null): string | null {
  if (server.kind === "local" || server.lastSeenAt != null || publicKey == null) {
    return null;
  }
  return buildInstallCommand(publicKey, server.username ?? "");
}

export const listServersFn = createServerFn({ method: "GET" }).handler(async () => {
  await authorize("project:read");
  const database = getDatabase();
  const publicKey = getPanelPublicKey(database);
  const samples = listLatestHostSamples(database);
  const servers = [];
  for (const server of listServers(database)) {
    servers.push({
      ...server,
      hostSample: samples.get(server.id) ?? null,
      installCommand: installCommandFor(server, publicKey),
    });
  }
  // The key pair exists once the worker started for the first time.
  return { keyReady: publicKey != null, servers };
});

export const addServerFn = createServerFn({ method: "POST" })
  .validator(serverInputSchema)
  .handler(async ({ data }) => {
    const user = await authorize("settings:write");
    return addServer(getDatabase(), { input: data, actor: userActor(user) }).id;
  });

export const removeServerFn = createServerFn({ method: "POST" })
  .validator(z.object({ serverId: idSchema }))
  .handler(async ({ data }) => {
    const user = await authorize("settings:write");
    removeServer(getDatabase(), { serverId: data.serverId, actor: userActor(user) });
  });

export const setServerAcceptsApplicationsFn = createServerFn({ method: "POST" })
  .validator(z.object({ serverId: idSchema, acceptsApplications: z.boolean() }))
  .handler(async ({ data }) => {
    const user = await authorize("settings:write");
    setServerAcceptsApplications(getDatabase(), {
      serverId: data.serverId,
      acceptsApplications: data.acceptsApplications,
      actor: userActor(user),
    });
  });
