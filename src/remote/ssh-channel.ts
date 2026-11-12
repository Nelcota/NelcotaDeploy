import type { ClientChannel } from "ssh2";

/**
 * Waits for a channel within a caller's deadline and closes it if it opens after cancellation.
 *
 * @param opening - The in-flight SSH request.
 * @param signal - Cancellation signal for the operation.
 * @returns The opened channel.
 * @throws The opening failure or the cancellation reason.
 */
export async function waitForSshChannel(
  opening: Promise<ClientChannel>,
  signal: AbortSignal,
): Promise<ClientChannel> {
  const { promise: aborted, reject } = Promise.withResolvers<never>();
  const onAbort = () => reject(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  using _listener = { [Symbol.dispose]: () => signal.removeEventListener("abort", onAbort) };
  if (signal.aborted) {
    onAbort();
  }

  const opened = opening.then((channel) => {
    if (signal.aborted) {
      channel.destroy();
      signal.throwIfAborted();
    }

    return channel;
  });
  return await Promise.race([opened, aborted]);
}
