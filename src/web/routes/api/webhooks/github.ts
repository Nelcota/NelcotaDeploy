import { createFileRoute } from "@tanstack/react-router";

import { getConfig } from "@/config";
import { getDatabase } from "@/db";
import { getGitHubApp, readGitHubAppCredentials } from "@/github";
import { createLogger } from "@/logging";
import { getSecretBox } from "@/secrets";
import {
  handleGitHubDelivery,
  InvalidWebhookRequestError,
  InvalidWebhookSignatureError,
} from "@/webhooks";

/** GitHub caps payloads at 25 MB; pushes are far smaller, so 1 MB is plenty. */
const MAX_BODY_BYTES = 1_048_576;
/** Accepted deliveries queue a deploy; ignored ones (other branches, pings) just succeed. */
const HTTP_ACCEPTED = 202;
const HTTP_OK = 200;

/** The connected GitHub App signs its deliveries; repositories set up by hand use the env secret. */
async function acceptedSecrets(): Promise<string[]> {
  const secrets: string[] = [];
  const manualSecret = getConfig().GITHUB_WEBHOOK_SECRET;
  if (manualSecret != null) {
    secrets.push(manualSecret);
  }
  const database = getDatabase();
  if (getGitHubApp(database) == null) {
    return secrets;
  }
  const app = await readGitHubAppCredentials(database, await getSecretBox());
  if (app?.webhookSecret != null) {
    secrets.push(app.webhookSecret);
  }
  return secrets;
}

export const Route = createFileRoute("/api/webhooks/github")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secrets = await acceptedSecrets();
        if (secrets.length === 0) {
          return Response.json({ error: "webhook secret not configured" }, { status: 503 });
        }
        const declaredLength = Number(request.headers.get("content-length") ?? "0");
        if (Number.isFinite(declaredLength) === false || declaredLength > MAX_BODY_BYTES) {
          return Response.json({ error: "payload too large" }, { status: 413 });
        }
        const rawBody = await request.text();
        if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) {
          return Response.json({ error: "payload too large" }, { status: 413 });
        }
        try {
          const outcome = await handleGitHubDelivery(
            getDatabase(),
            {
              deliveryId: request.headers.get("x-github-delivery"),
              event: request.headers.get("x-github-event"),
              signature: request.headers.get("x-hub-signature-256"),
              rawBody,
            },
            secrets,
          );
          return Response.json(outcome, {
            status: outcome.status === "accepted" ? HTTP_ACCEPTED : HTTP_OK,
          });
        } catch (error) {
          if (error instanceof InvalidWebhookSignatureError) {
            return Response.json({ error: "invalid signature" }, { status: 401 });
          }
          if (error instanceof InvalidWebhookRequestError) {
            return Response.json({ error: error.message }, { status: 400 });
          }
          createLogger("webhook").error({ err: error }, "webhook processing failed");
          return Response.json({ error: "internal error" }, { status: 500 });
        }
      },
    },
  },
});
