import { afterAll, describe, expect, test } from "bun:test";

import pino from "pino";

import { openMemoryDatabase } from "@/db";
import { saveSystemSettings } from "@/settings";
import { DEFAULT_SYSTEM_SETTINGS } from "@/shared/schemas/settings.schema";

import { AlertDeliveryError } from "./alert.errors";
import { alertPayload, notify, sendAlert } from "./alert.service";

const ALERT = { title: "Deploy falhou", text: "O deploy de API falhou.", link: "https://painel/x" };
const received: unknown[] = [];
// A real local webhook: 200 for /ok, 500 for anything else.
const webhook = Bun.serve({
  port: 0,
  async fetch(request) {
    received.push(await request.json());
    return new Response(null, { status: new URL(request.url).pathname === "/ok" ? 200 : 500 });
  },
});
const silent = pino({ level: "silent" });

afterAll(async () => {
  await webhook.stop(true);
});

describe("alertPayload", () => {
  test("puts the same message where Discord and Slack read it", () => {
    const payload = alertPayload(ALERT);

    expect(payload.content).toBe("Deploy falhou: O deploy de API falhou.\nhttps://painel/x");
    expect(payload.text).toBe(payload.content);
  });

  test("leaves the link line out when there is none", () => {
    expect(alertPayload({ title: "T", text: "x" }).content).toBe("T: x");
  });
});

describe("sendAlert", () => {
  test("posts the message to the webhook", async () => {
    received.length = 0;

    await sendAlert(`${webhook.url.origin}/ok`, ALERT);

    expect(received).toEqual([alertPayload(ALERT)]);
  });

  test("throws AlertDeliveryError when the webhook refuses the message", async () => {
    const error = await sendAlert(`${webhook.url.origin}/fail`, ALERT).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(AlertDeliveryError);
  });

  test("throws AlertDeliveryError when the webhook cannot be reached", async () => {
    const error = await sendAlert("http://127.0.0.1:1/ok", ALERT).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(AlertDeliveryError);
  });
});

describe("notify", () => {
  test("sends nothing when no webhook is configured", async () => {
    received.length = 0;

    await notify(openMemoryDatabase(), silent, ALERT);

    expect(received).toEqual([]);
  });

  test("never throws when the webhook fails", async () => {
    const database = openMemoryDatabase();
    saveSystemSettings(database, {
      ...DEFAULT_SYSTEM_SETTINGS,
      alertWebhookUrl: `${webhook.url.origin}/fail`,
    });

    const result = await notify(database, silent, ALERT);

    expect(result).toBeUndefined();
  });
});
