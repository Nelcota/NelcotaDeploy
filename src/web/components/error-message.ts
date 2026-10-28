const NETWORK_MESSAGE = "Sem conexão com o servidor. Verifique a rede e tente novamente.";

/**
 * Turns any failure into text for the user.
 *
 * @remarks
 * Server functions never send internal details: a middleware replaces every error with a
 * Portuguese `PublicError` before it leaves the server. In the browser, a `TypeError` means
 * the request never reached the server, and its English text must not be shown.
 *
 * @param error - What was thrown.
 * @param fallback - Text for failures without a usable message.
 * @returns A message in Portuguese.
 */
export function toUserMessage(error: unknown, fallback: string): string {
  if (error instanceof TypeError) {
    return NETWORK_MESSAGE;
  }
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }
  return fallback;
}
