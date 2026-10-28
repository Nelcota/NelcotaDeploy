/** Thrown when a webhook signature header is missing or does not match the payload. */
export class InvalidWebhookSignatureError extends Error {
  constructor() {
    super("Webhook signature is missing or invalid");
    this.name = "InvalidWebhookSignatureError";
  }
}

/** Thrown when required webhook headers are missing or malformed. */
export class InvalidWebhookRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidWebhookRequestError";
  }
}
