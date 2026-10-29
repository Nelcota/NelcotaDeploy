/** Thrown when the alert webhook does not accept a message. */
export class AlertDeliveryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AlertDeliveryError";
  }
}
