import { expect, test } from "bun:test";

import { openMemoryDatabase } from "@/db";

import { handleGitHubDelivery } from "./github-webhook.service";
import { readGitHubDelivery } from "./webhook-request";
import {
  InvalidWebhookRequestError,
  InvalidWebhookSignatureError,
  WebhookPayloadTooLargeError,
} from "./webhook.errors";

const SECRET = "test-webhook-secret";
const MAX_BYTES = 1_048_576;
const FORMATTED_SIGNATURE = `sha256=${"0".repeat(64)}`;

function request(body: BodyInit | null, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/webhooks/github", {
    method: "POST",
    headers: {
      "x-github-delivery": "delivery-1",
      "x-github-event": "ping",
      "x-hub-signature-256": FORMATTED_SIGNATURE,
      ...headers,
    },
    body,
  });
}

test("preserves signed UTF-8 bytes split across chunks, including the BOM", async () => {
  const body = '\uFEFF{"zen":"café"}';
  const bytes = new TextEncoder().encode(body);
  const signature = `sha256=${new Bun.CryptoHasher("sha256", SECRET).update(bytes).digest("hex")}`;
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) {
        controller.enqueue(Uint8Array.of(byte));
      }

      controller.close();
    },
  });
  const database = openMemoryDatabase();
  using _connection = database.$client;

  const delivery = await readGitHubDelivery(
    request(source, { "x-hub-signature-256": signature, "content-length": String(bytes.length) }),
  );
  const result = await handleGitHubDelivery(database, delivery, [SECRET]);

  expect(delivery.rawBody).toBe(body);
  expect(result).toEqual({ status: "ignored", reason: "ping" });
});

test("rejects malformed signatures before requesting any body chunk", async () => {
  let read = false;
  const source = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        read = true;
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );

  const result = await readGitHubDelivery(
    request(source, { "x-hub-signature-256": "sha256=bad" }),
  ).catch((error: unknown) => error);

  expect(result).toBeInstanceOf(InvalidWebhookSignatureError);
  expect(read).toBe(false);
});

test("accepts a body of exactly one MiB", async () => {
  const body = "é".repeat(MAX_BYTES / 2);

  const delivery = await readGitHubDelivery(request(body));

  expect(delivery.rawBody).toBe(body);
});

test("cancels an oversized stream with no Content-Length header", async () => {
  const chunks = [new Uint8Array(MAX_BYTES).fill(65), Uint8Array.of(65)];
  let reads = 0;
  let cancelled = false;
  const source = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        const chunk = chunks[reads];
        if (chunk == null) {
          throw new Error("The reader continued past the limit");
        }

        reads += 1;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );

  const result = await readGitHubDelivery(request(source)).catch((error: unknown) => error);

  expect(result).toBeInstanceOf(WebhookPayloadTooLargeError);
  expect(cancelled).toBe(true);
  expect(reads).toBe(chunks.length);
});

test("rejects a declared size above the limit", async () => {
  const result = await readGitHubDelivery(
    request("{}", { "content-length": String(MAX_BYTES + 1) }),
  ).catch((error: unknown) => error);

  expect(result).toBeInstanceOf(WebhookPayloadTooLargeError);
});

test.each(["-1", "1.5", "2e2", "NaN", "Infinity", "1, 2"])(
  "rejects invalid Content-Length %p",
  async (length) => {
    const result = await readGitHubDelivery(request("{}", { "content-length": length })).catch(
      (error: unknown) => error,
    );

    expect(result).toHaveProperty("message", "Invalid Content-Length header");
  },
);

test("rejects a body whose byte length differs from its header", async () => {
  const result = await readGitHubDelivery(request("é", { "content-length": "1" })).catch(
    (error: unknown) => error,
  );

  expect(result).toHaveProperty("message", "Webhook body does not match Content-Length");
});

test("rejects incomplete UTF-8 at the end of a stream", async () => {
  const result = await readGitHubDelivery(request(Uint8Array.of(0xc3))).catch(
    (error: unknown) => error,
  );

  expect(result).toBeInstanceOf(InvalidWebhookRequestError);
  expect(result).toHaveProperty("message", "Webhook body could not be read as UTF-8");
});

test.each([null, ""])("rejects an empty webhook body", async (body) => {
  const result = await readGitHubDelivery(request(body)).catch((error: unknown) => error);

  expect(result).toHaveProperty("message", "Webhook body is empty");
});
