import { createFileRoute } from "@tanstack/react-router";

import { getConfig } from "@/config";
import { getDatabase } from "@/db";
import { readGitHubAppWebhookSecret } from "@/github";
import { createLogger } from "@/logging";
import { getSecretBox } from "@/secrets";
import {
  handleGitHubDelivery,
  InvalidWebhookRequestError,
  InvalidWebhookSignatureError,
  readGitHubDelivery,
  WebhookPayloadTooLargeError,
} from "@/webhooks";

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

  const appSecret = await readGitHubAppWebhookSecret(getDatabase(), getSecretBox);
  if (appSecret != null) {
    secrets.push(appSecret);
  }

  return secrets;
}

export const Route = createFileRoute("/api/webhooks/github")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const delivery = await readGitHubDelivery(request);
          const secrets = await acceptedSecrets();
          if (secrets.length === 0) {
            return Response.json({ error: "webhook secret not configured" }, { status: 503 });
          }

          const outcome = await handleGitHubDelivery(getDatabase(), delivery, secrets);
          return Response.json(outcome, {
            status: outcome.status === "accepted" ? HTTP_ACCEPTED : HTTP_OK,
          });
        } catch (error) {
          if (error instanceof InvalidWebhookSignatureError) {
            return Response.json({ error: "invalid signature" }, { status: 401 });
          }
          if (error instanceof WebhookPayloadTooLargeError) {
            return Response.json({ error: "payload too large" }, { status: 413 });
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
