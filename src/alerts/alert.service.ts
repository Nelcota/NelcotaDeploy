import type { Logger } from "pino";

import type { Database } from "@/db";
import { isPublicIpAddress, lookupAllWithTimeout } from "@/domains";
import { getSystemSettings } from "@/settings";
import { systemSettingsSchema } from "@/shared/schemas/settings.schema";

import { AlertDeliveryError } from "./alert.errors";

const DELIVERY_TIMEOUT_IN_MS = 5000;

type DeliveryNetwork = {
  readonly lookup: (hostname: string) => Promise<readonly string[]>;
  readonly fetch: (url: URL, options: BunFetchRequestInit) => Promise<Response>;
};

const deliveryNetwork: DeliveryNetwork = { lookup: lookupAllWithTimeout, fetch };

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
 * @param webhookUrl - Public HTTPS URL of the incoming webhook.
 * @param alert - The alert.
 * @param network - DNS and HTTP operations, replaceable in tests.
 * @throws {AlertDeliveryError} When the destination is unsafe, unreachable, or refuses the message.
 */
export async function sendAlert(
  webhookUrl: string,
  alert: Alert,
  network: DeliveryNetwork = deliveryNetwork,
): Promise<void> {
  const parsed = systemSettingsSchema.shape.alertWebhookUrl.safeParse(webhookUrl);
  if (parsed.success === false || parsed.data == null) {
    throw new AlertDeliveryError("The alert webhook must use a public HTTPS URL");
  }

  const target = new URL(parsed.data);
  const addresses = await network.lookup(target.hostname);
  const address = addresses[0];
  if (address == null || addresses.some((candidate) => isPublicIpAddress(candidate) === false)) {
    throw new AlertDeliveryError(
      "The alert webhook did not resolve exclusively to public addresses",
    );
  }

  const host = target.host;
  const serverName = target.hostname;
  // Connect to the checked address while keeping the original HTTP and TLS identity.
  target.hostname = address.includes(":") ? `[${address}]` : address;
  let response: Response;
  try {
    response = await network.fetch(target, {
      method: "POST",
      headers: { "content-type": "application/json", Host: host },
      body: JSON.stringify(alertPayload(alert)),
      tls: { serverName },
      proxy: false,
      redirect: "error",
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_IN_MS),
    });
    await response.body?.cancel();
  } catch {
    // Fetch errors can include the URL, whose path or query may contain credentials.
    throw new AlertDeliveryError("The alert webhook could not be reached");
  }

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
  const webhookUrl = getSystemSettings(database, { includeSecrets: true }).alertWebhookUrl;
  if (webhookUrl == null) {
    return;
  }
  try {
    await sendAlert(webhookUrl, alert);
  } catch (error) {
    logger.warn({ err: error, title: alert.title }, "alert not delivered");
  }
}
