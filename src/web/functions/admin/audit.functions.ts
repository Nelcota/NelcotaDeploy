import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { listAuditEvents } from "@/audit";
import { getDatabase } from "@/db";
import { authorize } from "@/web/server/authorization";
import { listWebhookDeliveries } from "@/webhooks";

const AUDIT_PAGE_SIZE = 50;
const WEBHOOK_PAGE_SIZE = 30;

export const listAuditEventsFn = createServerFn({ method: "GET" })
  .validator(z.object({ before: z.iso.datetime().optional() }))
  .handler(async ({ data }) => {
    await authorize("audit:read");
    return listAuditEvents(getDatabase(), { limit: AUDIT_PAGE_SIZE, before: data.before }).map(
      (event) => ({
        id: event.id,
        actorType: event.actorType,
        actorLabel: event.actorLabel,
        action: event.action,
        targetType: event.targetType,
        targetId: event.targetId,
        details: JSON.stringify(event.metadata),
        createdAt: event.createdAt,
      }),
    );
  });

export const listWebhookDeliveriesFn = createServerFn({ method: "GET" }).handler(async () => {
  await authorize("audit:read");
  return listWebhookDeliveries(getDatabase(), WEBHOOK_PAGE_SIZE);
});
