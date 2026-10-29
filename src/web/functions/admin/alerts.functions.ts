import { createServerFn } from "@tanstack/react-start";

import { sendAlert } from "@/alerts";
import { getConfig } from "@/config";
import { getDatabase } from "@/db";
import { getSystemSettings } from "@/settings";
import { authorize } from "@/web/server/authorization";
import { PublicError } from "@/web/server/public-error";

/** Sends a test message to the saved alert webhook. */
export const sendTestAlertFn = createServerFn({ method: "POST" }).handler(async () => {
  await authorize("settings:write");
  const webhookUrl = getSystemSettings(getDatabase()).alertWebhookUrl;
  if (webhookUrl == null) {
    throw new PublicError("Salve a URL do webhook antes de enviar um teste.");
  }
  await sendAlert(webhookUrl, {
    title: "Teste",
    text: "Os alertas do Nelcota Deploy vão chegar aqui.",
    link: getConfig().PUBLIC_URL,
  });
});
