/** Thrown when a webhook signature header is missing or does not match the payload. */
export class InvalidWebhookSignatureError extends Error {
  constructor() {
    super("Webhook signature is missing or invalid");
    this.name = "InvalidWebhookSignatureError";
  }
}

/** Thrown when required webhook headers are missing or malformed. */
export class InvalidWebhookRequestError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "InvalidWebhookRequestError";
  }
}

/** Thrown when a webhook body exceeds the endpoint's byte limit. */
export class WebhookPayloadTooLargeError extends Error {
  constructor() {
    super("Webhook payload is too large");
    this.name = "WebhookPayloadTooLargeError";
  }
}
