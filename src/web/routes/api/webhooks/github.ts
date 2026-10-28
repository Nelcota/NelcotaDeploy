import { createFileRoute } from "@tanstack/react-router";

import { getConfig } from "@/config";
import { getDatabase } from "@/db";
import { createLogger } from "@/logging";
import {
  handleGitHubDelivery,
  InvalidWebhookRequestError,
  InvalidWebhookSignatureError,
} from "@/webhooks";

/** GitHub caps payloads at 25 MB; pushes are far smaller, so 1 MB is plenty. */
const MAX_BODY_BYTES = 1_048_576;

export const Route = createFileRoute("/api/webhooks/github")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = getConfig().GITHUB_WEBHOOK_SECRET;
        if (secret == null) {
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
            secret,
          );
          return Response.json(outcome, { status: outcome.status === "accepted" ? 202 : 200 });
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
