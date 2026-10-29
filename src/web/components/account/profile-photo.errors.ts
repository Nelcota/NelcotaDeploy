/** Thrown when the browser cannot decode or re-encode the chosen picture. */
export class ImageProcessingError extends Error {
  constructor(reason: string) {
    super(`Could not process image: ${reason}`);
    this.name = "ImageProcessingError";
  }
}

/**
 * Error shown to the user when the picture cannot be read; useAction toasts its message,
 * so it is written in Portuguese and keeps the technical reason as the cause.
 */
export class UnreadableImageError extends Error {
  constructor(cause: unknown) {
    super("Não foi possível ler esta imagem. Tente outra foto.", { cause });
    this.name = "UnreadableImageError";
  }
}
