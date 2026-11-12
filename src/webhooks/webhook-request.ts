import type { GitHubDelivery } from "./github-webhook.service";
import { requireGitHubSignature } from "./webhook-event";
import { InvalidWebhookRequestError, WebhookPayloadTooLargeError } from "./webhook.errors";

const MAX_BODY_BYTES = 1_048_576;
const CONTENT_LENGTH_PATTERN = /^\d+$/;

function contentLength(header: string | null): number | null {
  if (header == null) {
    return null;
  }

  if (CONTENT_LENGTH_PATTERN.test(header) === false) {
    throw new InvalidWebhookRequestError("Invalid Content-Length header");
  }

  const length = Number(header);
  if (Number.isFinite(length) === false || length > MAX_BODY_BYTES) {
    throw new WebhookPayloadTooLargeError();
  }

  return length;
}

function checkBodyLength(declaredLength: number | null, bytes: number): void {
  if (declaredLength != null && declaredLength !== bytes) {
    throw new InvalidWebhookRequestError("Webhook body does not match Content-Length");
  }

  if (bytes === 0) {
    throw new InvalidWebhookRequestError("Webhook body is empty");
  }
}

async function decodeBody(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  declaredLength: number | null,
): Promise<string> {
  // A valid UTF-8 string must round-trip to the signed bytes, including an initial BOM.
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let bytes = 0;
  let body = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }

    bytes += chunk.value.byteLength;
    if (bytes > MAX_BODY_BYTES) {
      throw new WebhookPayloadTooLargeError();
    }

    body += decoder.decode(chunk.value, { stream: true });
  }

  checkBodyLength(declaredLength, bytes);
  return body + decoder.decode();
}

async function readBody(request: Request, declaredLength: number | null): Promise<string> {
  const reader = request.body?.getReader();
  if (reader == null) {
    throw new InvalidWebhookRequestError("Webhook body is empty");
  }

  using _reader = { [Symbol.dispose]: () => reader.releaseLock() };
  try {
    return await decodeBody(reader, declaredLength);
  } catch (cause) {
    const failure =
      cause instanceof WebhookPayloadTooLargeError || cause instanceof InvalidWebhookRequestError
        ? cause
        : new InvalidWebhookRequestError("Webhook body could not be read as UTF-8", { cause });
    await reader.cancel(failure).catch((cancelError: unknown) => {
      failure.cause ??= cancelError;
    });
    throw failure;
  }
}

/**
 * Reads a GitHub webhook with a bounded body and preserves its UTF-8 representation.
 *
 * @param request - Incoming webhook request.
 * @returns Delivery headers and body for signature verification.
 * @throws {InvalidWebhookSignatureError} When the signature header has an invalid format.
 * @throws {InvalidWebhookRequestError} When the body or its length is invalid.
 * @throws {WebhookPayloadTooLargeError} When the body exceeds the byte limit.
 */
export async function readGitHubDelivery(request: Request): Promise<GitHubDelivery> {
  const signature = requireGitHubSignature(request.headers.get("x-hub-signature-256"));
  const declaredLength = contentLength(request.headers.get("content-length"));
  const rawBody = await readBody(request, declaredLength);
  return {
    deliveryId: request.headers.get("x-github-delivery"),
    event: request.headers.get("x-github-event"),
    signature,
    rawBody,
  };
}
