const POLL_INTERVAL_IN_MS = 500;
/**
 * Quiet polls required after the source finished before the stream ends, so lines written
 * right after the final status (such as cleanup messages) still reach the browser.
 */
const QUIET_POLLS_BEFORE_END = 4;
const HEARTBEAT_INTERVAL_IN_MS = 15_000;
const MAX_CURSOR = Number.MAX_SAFE_INTEGER;
const encoder = new TextEncoder();

/** One batch read by an event stream. */
export type EventBatch<T extends { readonly id: number }> = {
  readonly items: readonly T[];
  /** When true and no items are pending, the stream sends "end" and closes. */
  readonly finished: boolean;
  /** Payload of the final "end" event. */
  readonly summary?: unknown;
};

/**
 * Reads the resume cursor from `Last-Event-ID` (sent by EventSource on reconnect) or the
 * `after` query parameter.
 *
 * @param request - Incoming request.
 * @returns The last id the client already has, or 0.
 */
export function readCursor(request: Request): number {
  const raw =
    request.headers.get("last-event-id") ?? new URL(request.url).searchParams.get("after") ?? "0";
  const cursor = Number.parseInt(raw, 10);
  if (Number.isFinite(cursor) === false || cursor < 0 || cursor > MAX_CURSOR) {
    return 0;
  }
  return cursor;
}

/**
 * Formats one server-sent event.
 *
 * @param event - Event name.
 * @param data - JSON-serializable payload.
 * @param id - Optional id the browser sends back as Last-Event-ID.
 * @returns The wire format.
 */
export function formatServerSentEvent(event: string, data: unknown, id?: number): string {
  const idLine = id == null ? "" : `id: ${id}\n`;
  return `${idLine}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Streams rows stored in SQLite as server-sent events, polling for new rows.
 *
 * @remarks
 * Every process writes logs to the shared database, so polling by id works across the
 * web and worker processes without any message broker. Reconnecting clients resume from
 * their last id, so no line is lost or repeated.
 *
 * @param request - Incoming request; the stream stops when it is aborted.
 * @param poll - Reads rows after a cursor.
 * @param onError - Receives read failures, which end the stream.
 * @returns The streaming response.
 */
export function createEventStreamResponse<T extends { readonly id: number }>(
  request: Request,
  poll: (afterId: number) => EventBatch<T>,
  onError: (error: unknown) => void,
): Response {
  let cursor = readCursor(request);
  let quietPolls = 0;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    clearTimeout(pollTimer);
    clearInterval(heartbeatTimer);
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => controller.enqueue(encoder.encode(text));
      const close = () => {
        stop();
        controller.close();
      };
      const tick = () => {
        if (request.signal.aborted) {
          close();
          return;
        }
        try {
          const batch = poll(cursor);
          for (const item of batch.items) {
            send(formatServerSentEvent("log", item, item.id));
            cursor = item.id;
          }
          quietPolls = batch.finished && batch.items.length === 0 ? quietPolls + 1 : 0;
          if (quietPolls >= QUIET_POLLS_BEFORE_END) {
            send(formatServerSentEvent("end", batch.summary ?? {}));
            close();
            return;
          }
        } catch (error) {
          send(formatServerSentEvent("error", { message: "Não foi possível ler os logs." }));
          close();
          onError(error);
          return;
        }
        pollTimer = setTimeout(tick, POLL_INTERVAL_IN_MS);
      };
      send("retry: 3000\n\n");
      heartbeatTimer = setInterval(() => send(": keep-alive\n\n"), HEARTBEAT_INTERVAL_IN_MS);
      request.signal.addEventListener("abort", stop);
      tick();
    },
    cancel: stop,
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
