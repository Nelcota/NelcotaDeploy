import { describe, expect, test } from "bun:test";

import { createEventStreamResponse, formatServerSentEvent, readCursor } from "./event-stream";

describe("readCursor", () => {
  test("prefers Last-Event-ID sent by a reconnecting browser", () => {
    const request = new Request("http://x/logs?after=5", { headers: { "Last-Event-ID": "42" } });

    expect(readCursor(request)).toBe(42);
  });

  test.each(["-1", "abc", "99999999999999999999"])(
    "falls back to 0 for invalid cursor %p",
    (value) => {
      expect(readCursor(new Request(`http://x/logs?after=${value}`))).toBe(0);
    },
  );
});

describe("createEventStreamResponse", () => {
  test("pauses polling while a slow reader leaves a batch queued and resumes at its cursor", async () => {
    const cursors: number[] = [];
    const response = createEventStreamResponse(
      new Request("http://x/logs"),
      (cursor) => {
        cursors.push(cursor);
        return { items: [{ id: cursor + 1, message: "x".repeat(70_000) }], finished: false };
      },
      () => undefined,
    );
    const reader = response.body?.getReader();
    if (reader == null) {
      throw new Error("Expected an event stream body");
    }
    await using _reader = { [Symbol.asyncDispose]: async () => await reader.cancel() };
    const pausedReaderWaitInMs = 1100;
    await Bun.sleep(pausedReaderWaitInMs);
    expect(cursors).toEqual([0]);
    await reader.read();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("id: 1");
    await reader.read();
    expect(cursors).toEqual([0, 1]);
  });

  test("does not schedule another poll after cancellation during an in-flight read", async () => {
    const batch = Promise.withResolvers<{ items: { id: number }[]; finished: boolean }>();
    let polls = 0;
    const response = createEventStreamResponse(
      new Request("http://x/logs"),
      async () => {
        polls += 1;
        return await batch.promise;
      },
      () => undefined,
    );
    await response.body?.cancel();
    batch.resolve({ items: [{ id: 1 }], finished: false });
    const cancelledPollWaitInMs = 600;
    await Bun.sleep(cancelledPollWaitInMs);
    expect(polls).toBe(1);
  });

  test("stops an asynchronous authorized stream when access is revoked", async () => {
    let authorized = true;
    let error: unknown;
    const response = createEventStreamResponse(
      new Request("http://x/logs"),
      async () => {
        await Promise.resolve();
        if (authorized === false) {
          throw new Error("Session revoked");
        }
        authorized = false;
        return { items: [{ id: 1, message: "before revocation" }], finished: false };
      },
      (failure) => {
        error = failure;
      },
    );

    const body = await response.text();

    expect(body.match(/event: log/g)).toHaveLength(1);
    expect(body).toContain("event: error");
    expect(error).toBeInstanceOf(Error);
  });
  test("streams rows after the cursor and ends when finished", async () => {
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const request = new Request("http://x/logs", { headers: { "Last-Event-ID": "1" } });

    const response = createEventStreamResponse(
      request,
      (after) => ({
        items: rows.filter((row) => row.id > after),
        finished: true,
        summary: { status: "succeeded" },
      }),
      () => undefined,
    );
    const body = await response.text();

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(body).toContain(formatServerSentEvent("log", { id: 2 }, 2));
    expect(body).toContain(formatServerSentEvent("log", { id: 3 }, 3));
    expect(body).not.toContain("id: 1\n");
    expect(body).toContain('event: end\ndata: {"status":"succeeded"}');
  });

  test("still delivers lines written right after the source finished", async () => {
    let polls = 0;

    const response = createEventStreamResponse(
      new Request("http://x/logs"),
      () => {
        polls += 1;
        return { items: polls === 2 ? [{ id: 9 }] : [], finished: true };
      },
      () => undefined,
    );
    const body = await response.text();

    expect(body).toContain(formatServerSentEvent("log", { id: 9 }, 9));
    expect(body.indexOf("id: 9")).toBeLessThan(body.indexOf("event: end"));
  });
});
