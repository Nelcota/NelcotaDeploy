import { expect, test } from "bun:test";
import { Duplex, PassThrough } from "node:stream";

import type { ClientChannel } from "ssh2";

import { createRemoteRunner } from "./remote-runner";

const CHANNEL_TIMEOUT_IN_MS = 20;
const RUN_TIMEOUT_IN_MS = 5_000;
const CLEANUP_TEST_TIMEOUT_IN_MS = 15_000;

function channelFixture() {
  const written = Promise.withResolvers<void>();
  const stderr = new PassThrough();
  let inputReceived = false;
  const stream = new Duplex({
    read() {
      // The SSH peer supplies output separately from stdin.
    },
    write(_chunk, _encoding, callback) {
      inputReceived = true;
      written.resolve();
      callback();
    },
  });
  const channel = Object.assign(stream, { stderr }) as unknown as ClientChannel;
  return {
    channel,
    written: written.promise,
    get inputReceived() {
      return inputReceived;
    },
  };
}

test.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 0, 1.5])(
  "rejects the invalid SSH timeout %p before opening a channel",
  async (timeoutInMs) => {
    const run = createRemoteRunner({
      exec: () => Promise.reject(new Error("Unexpected SSH request")),
    });

    const result = await run(["echo", "test"], { timeoutInMs }).catch((error: unknown) => error);

    expect(result).toBeInstanceOf(RangeError);
  },
);

test("times out while opening and closes the late SSH channel without sending stdin", async () => {
  const opening = Promise.withResolvers<ClientChannel>();
  const fixture = channelFixture();
  const run = createRemoteRunner({ exec: () => opening.promise });

  const result = await run(["echo", "test"], { timeoutInMs: CHANNEL_TIMEOUT_IN_MS });
  opening.resolve(fixture.channel);
  await Promise.resolve();

  expect(result).toMatchObject({ exitCode: 1, timedOut: true, aborted: false });
  expect(fixture.channel.destroyed).toBe(true);
  expect(fixture.inputReceived).toBe(false);
});

test("does not open an SSH channel when the caller is already cancelled", async () => {
  const controller = new AbortController();
  controller.abort();
  let opened = false;
  const run = createRemoteRunner({
    exec: () => {
      opened = true;
      return Promise.reject(new Error("Unexpected SSH request"));
    },
  });

  const result = await run(["echo", "test"], {
    timeoutInMs: RUN_TIMEOUT_IN_MS,
    signal: controller.signal,
  });

  expect(result).toMatchObject({ exitCode: 1, timedOut: false, aborted: true });
  expect(opened).toBe(false);
});

test("aborts a pending SSH request and handles its eventual rejection", async () => {
  const controller = new AbortController();
  const opening = Promise.withResolvers<ClientChannel>();
  const run = createRemoteRunner({ exec: () => opening.promise });

  const result = run(["echo", "test"], {
    timeoutInMs: RUN_TIMEOUT_IN_MS,
    signal: controller.signal,
  });
  controller.abort();
  opening.reject(new Error("SSH disconnected"));

  expect(await result).toMatchObject({ exitCode: 1, timedOut: false, aborted: true });
});

test("preserves an SSH failure that happens before cancellation", async () => {
  const failure = new Error("Cannot open SSH channel");
  const run = createRemoteRunner({ exec: () => Promise.reject(failure) });

  const result = await run(["echo", "test"], { timeoutInMs: RUN_TIMEOUT_IN_MS }).catch(
    (error: unknown) => error,
  );

  expect(result).toBe(failure);
});

test(
  "ends local SSH reads and closes a late stop channel when the peer stalls",
  async () => {
    const controller = new AbortController();
    const command = channelFixture();
    const lateStop = channelFixture();
    const openingStop = Promise.withResolvers<ClientChannel>();
    const stopRequested = Promise.withResolvers<void>();
    let openings = 0;
    const run = createRemoteRunner({
      exec: () => {
        openings += 1;
        if (openings === 1) {
          return Promise.resolve(command.channel);
        }

        stopRequested.resolve();
        return openingStop.promise;
      },
    });
    const result = run(["echo", "test"], {
      timeoutInMs: RUN_TIMEOUT_IN_MS,
      signal: controller.signal,
    });
    await command.written;

    command.channel.stderr.push(Buffer.from("NELCOTA_PID 100\n"));
    controller.abort();
    await stopRequested.promise;
    const outcome = await result;
    openingStop.resolve(lateStop.channel);
    await Promise.resolve();

    expect(outcome).toMatchObject({
      aborted: true,
      timedOut: false,
      stderr: "Could not confirm termination of the remote process\n",
    });
    expect(command.channel.listenerCount("data")).toBe(0);
    expect(command.channel.stderr.listenerCount("data")).toBe(0);
    expect(lateStop.channel.destroyed).toBe(true);
    expect(lateStop.inputReceived).toBe(false);
  },
  CLEANUP_TEST_TIMEOUT_IN_MS,
);
