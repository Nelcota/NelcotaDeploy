import { afterAll, describe, expect, test } from "bun:test";

import pino from "pino";

import { openMemoryDatabase } from "@/db";
import { saveSystemSettings } from "@/settings";
import { DEFAULT_SYSTEM_SETTINGS } from "@/shared/schemas/settings.schema";

import { AlertDeliveryError } from "./alert.errors";
import { alertPayload, notify, sendAlert } from "./alert.service";

const ALERT = {
  title: "Deployment failed",
  text: "The API deployment failed.",
  link: "https://panel.example.com/x",
};
const WEBHOOK_ORIGIN = "https://webhook.example.com:8443";
const PUBLIC_ADDRESS = "8.8.8.8";
const received: unknown[] = [];
// A real local webhook: 200 for /ok, 500 for anything else.
const webhook = Bun.serve({
  port: 0,
  async fetch(request) {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/redirect") {
      return new Response(null, { status: 307, headers: { Location: "/ok" } });
    }
    received.push(await request.json());
    return new Response(null, { status: pathname === "/ok" ? 200 : 500 });
  },
});
const silent = pino({ level: "silent" });
const localNetwork = {
  lookup: async () => await Promise.resolve([PUBLIC_ADDRESS]),
  fetch: async (url: URL, options: BunFetchRequestInit) => {
    const localUrl = new URL(webhook.url);
    localUrl.pathname = url.pathname;
    localUrl.search = url.search;
    return await fetch(localUrl, options);
  },
};

afterAll(async () => {
  await webhook.stop(true);
});

describe("alertPayload", () => {
  test("puts the same message where Discord and Slack read it", () => {
    const payload = alertPayload(ALERT);

    expect(payload.content).toBe(
      "Deployment failed: The API deployment failed.\nhttps://panel.example.com/x",
    );
    expect(payload.text).toBe(payload.content);
  });

  test("leaves the link line out when there is none", () => {
    expect(alertPayload({ title: "T", text: "x" }).content).toBe("T: x");
  });
});

describe("sendAlert", () => {
  test("posts the message to the webhook", async () => {
    received.length = 0;

    await sendAlert(`${WEBHOOK_ORIGIN}/ok`, ALERT, localNetwork);

    expect(received).toEqual([alertPayload(ALERT)]);
  });

  test("throws AlertDeliveryError when the webhook refuses the message", async () => {
    const error = await sendAlert(`${WEBHOOK_ORIGIN}/fail`, ALERT, localNetwork).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(AlertDeliveryError);
    expect(error).toHaveProperty("message", "The alert webhook answered 500");
  });

  test("throws AlertDeliveryError when the webhook cannot be reached", async () => {
    const network = {
      ...localNetwork,
      fetch: () => Promise.reject(new Error("transport error with confidential webhook URL")),
    };

    const error = await sendAlert(`${WEBHOOK_ORIGIN}/ok`, ALERT, network).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(AlertDeliveryError);
    expect(error).toHaveProperty("message", "The alert webhook could not be reached");
    expect(error).not.toHaveProperty("cause");
  });

  test("refuses to follow webhook redirects", async () => {
    received.length = 0;

    const error = await sendAlert(`${WEBHOOK_ORIGIN}/redirect`, ALERT, localNetwork).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(AlertDeliveryError);
    expect(received).toEqual([]);
  });
});

describe("sendAlert destination validation", () => {
  test("uses the checked IP and keeps the original host, port and TLS identity", async () => {
    const fetchCalls: { url: string; options: BunFetchRequestInit }[] = [];
    const network = {
      ...localNetwork,
      fetch: (url: URL, options: BunFetchRequestInit) => {
        fetchCalls.push({ url: url.href, options });
        return Promise.resolve(new Response(null, { status: 204 }));
      },
    };

    await sendAlert(`${WEBHOOK_ORIGIN}/hooks/alert?version=1`, ALERT, network);

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]).toMatchObject({
      url: `https://${PUBLIC_ADDRESS}:8443/hooks/alert?version=1`,
      options: {
        headers: { "content-type": "application/json", Host: "webhook.example.com:8443" },
        tls: { serverName: "webhook.example.com" },
        proxy: false,
        redirect: "error",
      },
    });
  });

  test.each([
    { scenario: "empty DNS results", addresses: [] },
    { scenario: "mixed public and private DNS results", addresses: [PUBLIC_ADDRESS, "10.0.0.1"] },
  ])("rejects $scenario", async ({ addresses }) => {
    const network = {
      lookup: () => Promise.resolve(addresses),
      fetch: () => Promise.reject(new Error("unexpected network request")),
    };

    const error = await sendAlert(`${WEBHOOK_ORIGIN}/ok`, ALERT, network).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(AlertDeliveryError);
    expect(error).toHaveProperty(
      "message",
      "The alert webhook did not resolve exclusively to public addresses",
    );
  });

  test("rejects a legacy HTTP setting before resolving or sending it", async () => {
    const network = {
      lookup: () => Promise.reject(new Error("unexpected DNS lookup")),
      fetch: () => Promise.reject(new Error("unexpected network request")),
    };

    const error = await sendAlert("http://webhook.example.com/ok", ALERT, network).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(AlertDeliveryError);
    expect(error).toHaveProperty("message", "The alert webhook must use a public HTTPS URL");
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
