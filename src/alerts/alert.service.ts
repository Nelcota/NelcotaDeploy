import type { Logger } from "pino";

import type { Database } from "@/db";
import { getSystemSettings } from "@/settings";

import { AlertDeliveryError } from "./alert.errors";

const DELIVERY_TIMEOUT_IN_MS = 5000;

/** Something an admin should know about without having the panel open. */
export type Alert = {
  readonly title: string;
  readonly text: string;
  /** Page of the panel with the details. */
  readonly link?: string;
};

/**
 * Builds the webhook body. Discord reads `content` and Slack reads `text`; each ignores the
 * other, so one body works for both.
 *
 * @param alert - The alert.
 * @returns JSON body for the webhook.
 */
export function alertPayload(alert: Alert): { content: string; text: string } {
  const message = [`${alert.title}: ${alert.text}`, alert.link ?? ""].filter(Boolean).join("\n");
  return { content: message, text: message };
}

/**
 * Posts an alert to a webhook.
 *
 * @param webhookUrl - Discord or Slack incoming webhook URL (http or https).
 * @param alert - The alert.
 * @param send - The fetch to use; the real one in production.
 * @throws {AlertDeliveryError} When the webhook cannot be reached or refuses the message.
 */
export async function sendAlert(
  webhookUrl: string,
  alert: Alert,
  send: typeof fetch = fetch,
): Promise<void> {
  let response: Response;
  try {
    response = await send(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(alertPayload(alert)),
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_IN_MS),
    });
  } catch (error) {
    throw new AlertDeliveryError("The alert webhook could not be reached", { cause: error });
  }
  await response.body?.cancel();
  if (response.ok === false) {
    throw new AlertDeliveryError(`The alert webhook answered ${response.status}`);
  }
}

/**
 * Sends an alert to the webhook in the system settings, when one is set. A failed delivery
 * is logged and never stops what triggered the alert.
 *
 * @param database - Database with the settings.
 * @param logger - Where delivery failures go.
 * @param alert - The alert.
 */
export async function notify(database: Database, logger: Logger, alert: Alert): Promise<void> {
  const webhookUrl = getSystemSettings(database).alertWebhookUrl;
  if (webhookUrl == null) {
    return;
  }
  try {
    await sendAlert(webhookUrl, alert);
  } catch (error) {
    logger.warn({ err: error, title: alert.title }, "alert not delivered");
  }
}
