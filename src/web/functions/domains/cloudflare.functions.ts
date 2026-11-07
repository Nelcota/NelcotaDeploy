import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { userActor } from "@/auth";
import { getConfig } from "@/config";
import { getDatabase } from "@/db";
import {
  applyCloudflareDns,
  cloudflareConnectionStatus,
  connectCloudflare,
  disconnectCloudflare,
  previewCloudflareDns,
} from "@/domains";
import { getSecretBox } from "@/secrets";
import {
  cloudflareTokenSchema,
  dnsConfirmationSchema,
} from "@/shared/schemas/dns/cloudflare.schema";
import { domainInputSchema } from "@/shared/schemas/domain.schema";
import { authorize, authorizeProject } from "@/web/server/authorization";

import { idSchema } from "../ids";

const targetSchema = z.object({ projectId: idSchema, hostname: domainInputSchema.shape.hostname });

export const getCloudflareConnectionFn = createServerFn({ method: "GET" }).handler(async () => {
  await authorize("project:read");
  return cloudflareConnectionStatus(getDatabase());
});

export const connectCloudflareFn = createServerFn({ method: "POST" })
  .validator(z.object({ token: cloudflareTokenSchema }))
  .handler(async ({ data }) => {
    const user = await authorize("settings:write");
    await connectCloudflare(
      { database: getDatabase(), secretBox: await getSecretBox() },
      { token: data.token, actor: userActor(user) },
    );
  });

export const disconnectCloudflareFn = createServerFn({ method: "POST" }).handler(async () => {
  const user = await authorize("settings:write");
  disconnectCloudflare(getDatabase(), userActor(user));
});

export const previewCloudflareDnsFn = createServerFn({ method: "GET" })
  .validator(targetSchema)
  .handler(async ({ data }) => {
    await authorizeProject("domain:write", data.projectId);
    return await previewCloudflareDns(
      {
        database: getDatabase(),
        secretBox: await getSecretBox(),
        publicUrl: getConfig().PUBLIC_URL,
      },
      data,
    );
  });

export const applyCloudflareDnsFn = createServerFn({ method: "POST" })
  .validator(targetSchema.extend({ confirmation: dnsConfirmationSchema }))
  .handler(async ({ data }) => {
    const user = await authorizeProject("domain:write", data.projectId);
    return await applyCloudflareDns(
      {
        database: getDatabase(),
        secretBox: await getSecretBox(),
        publicUrl: getConfig().PUBLIC_URL,
      },
      { ...data, actor: userActor(user) },
    );
  });
