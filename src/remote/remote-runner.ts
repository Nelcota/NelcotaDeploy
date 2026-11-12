import { on, once } from "node:events";
import type { Readable } from "node:stream";

import type { ClientChannel } from "ssh2";

import {
  CapturedOutput,
  type CommandRunner,
  DEFAULT_MAX_CAPTURED_BYTES,
  type ProcessResult,
  readLines,
  type RunProcessOptions,
} from "@/process";

import { buildRemoteScript, parsePidLine } from "./remote-script";
import { waitForSshChannel } from "./ssh-channel";
import type { SshConnection } from "./ssh-connection";

/** Largest delay `setTimeout` honors; longer ones fire at once. */
const MAX_TIMER_DELAY_IN_MS = 2_147_483_647;
const STOP_TIMEOUT_IN_MS = 10_000;
/** Exit code reported when the connection dropped before the command finished. */
const CONNECTION_LOST_EXIT_CODE = 255;
const OUTPUT_QUEUE_HIGH_WATER_MARK = 4;
const OUTPUT_QUEUE_LOW_WATER_MARK = 1;

type SshCommandConnection = Pick<SshConnection, "exec">;

/**
 * Kills a remote command and its children over a separate channel. Closing a channel alone
 * does not stop the process, so a cancelled build would otherwise keep running.
 *
 * @remarks
 * sshd starts each channel's command as a session leader, and `exec` keeps that process id,
 * so the negative id reaches the whole process group (git helpers, docker build steps).
 */
async function killRemoteProcess(
  connection: SshCommandConnection,
  pid: number,
  signal: AbortSignal,
): Promise<boolean> {
  const channel = await waitForSshChannel(connection.exec("sh -s", signal), signal);
  using _channel = { [Symbol.dispose]: () => channel.destroy() };
  const closed = once(channel, "close", { signal });
  channel.resume();
  channel.stderr.resume();
  channel.end(`kill -KILL -- -${pid} 2>/dev/null || kill -KILL ${pid} 2>/dev/null\n`);
  const args: readonly unknown[] = await closed;
  return args[0] === 0;
}

/** Stops the remote process once, when the timeout passes or the caller aborts. */
class RemoteStopper implements Disposable {
  readonly #connection: SshCommandConnection;
  readonly #timer: ReturnType<typeof setTimeout> | null;
  readonly #signal: AbortSignal | undefined;
  readonly #onAbort = () => this.#stop();
  readonly #stopped = new AbortController();
  readonly #shutdown = new AbortController();
  #shutdownTimer: ReturnType<typeof setTimeout> | undefined;
  #pid: number | null = null;
  #stopping: Promise<boolean> | null = null;
  timedOut = false;

  constructor(connection: SshCommandConnection, options: RunProcessOptions) {
    this.#connection = connection;
    this.#signal = options.signal;
    this.#timer =
      options.timeoutInMs > MAX_TIMER_DELAY_IN_MS
        ? null
        : setTimeout(() => {
            if (this.stopped.aborted === false) {
              this.timedOut = true;
              this.#stop();
            }
          }, options.timeoutInMs);
    this.#signal?.addEventListener("abort", this.#onAbort, { once: true });

    if (this.aborted) {
      this.#stop();
    }
  }

  /** Records the remote process id; stops it at once if a stop came in before. */
  usePid(pid: number): void {
    this.#pid = pid;

    if (this.stopped.aborted) {
      this.#kill();
    }
  }

  #stop(): void {
    if (this.stopped.aborted) {
      return;
    }

    this.#shutdownTimer = setTimeout(() => this.#shutdown.abort(), STOP_TIMEOUT_IN_MS);
    this.#stopped.abort();
    this.#kill();
  }

  #kill(): void {
    if (this.#pid == null || this.#stopping != null || this.shutdown.aborted) {
      return;
    }

    this.#stopping = killRemoteProcess(this.#connection, this.#pid, this.shutdown).catch(
      () => false,
    );
  }

  get stopped(): AbortSignal {
    return this.#stopped.signal;
  }

  get shutdown(): AbortSignal {
    return this.#shutdown.signal;
  }

  get aborted(): boolean {
    return this.#signal?.aborted === true;
  }

  async stoppedCleanly(): Promise<boolean> {
    return this.#stopping != null && (await this.#stopping);
  }

  [Symbol.dispose](): void {
    if (this.#timer != null) {
      clearTimeout(this.#timer);
    }

    clearTimeout(this.#shutdownTimer);
    this.#shutdown.abort();
    this.#signal?.removeEventListener("abort", this.#onAbort);
  }
}

/**
 * Creates a {@link CommandRunner} that runs commands on a server over an SSH connection.
 *
 * @remarks
 * Behaves like `runProcess`: same result shape, streamed lines, timeout and abort. The
 * command and its environment go to `sh -s` on stdin (see `buildRemoteScript`). A timeout or
 * abort stops channel setup or requests termination of the remote process by id.
 *
 * @param connection - Open or lazily opened connection to the server.
 * @returns The runner.
 * @throws {RangeError} When the timeout is not a positive safe integer.
 */
export function createRemoteRunner(connection: SshCommandConnection): CommandRunner {
  return async (command, options) => await runRemote(connection, command, options);
}

async function runRemote(
  connection: SshCommandConnection,
  command: readonly string[],
  options: RunProcessOptions,
): Promise<ProcessResult> {
  if (Number.isSafeInteger(options.timeoutInMs) === false || options.timeoutInMs < 1) {
    throw new RangeError(
      `timeoutInMs must be a positive safe integer, received ${options.timeoutInMs}`,
    );
  }

  const script = buildRemoteScript({ command, env: options.env, cwd: options.cwd });
  using stopper = new RemoteStopper(connection, options);
  const channel = await openCommandChannel(connection, stopper);

  if (channel == null || stopper.stopped.aborted) {
    channel?.destroy();
    return {
      exitCode: 1,
      stdout: "",
      stderr: "",
      timedOut: stopper.timedOut,
      aborted: stopper.aborted,
    };
  }

  using _channel = { [Symbol.dispose]: () => channel.destroy() };
  const output = await collectRemoteOutput(channel, { options, script }, stopper);
  return await commandResult(output, stopper);
}

async function commandResult(
  { code, stdout, stderr }: Awaited<ReturnType<typeof collectRemoteOutput>>,
  stopper: RemoteStopper,
): Promise<ProcessResult> {
  const stopped = stopper.stopped.aborted;
  if (stopped && code == null && (await stopper.stoppedCleanly()) === false) {
    stderr.append("Could not confirm termination of the remote process");
  }

  if (code == null && stopped === false) {
    stderr.append("SSH connection lost");
  }

  return {
    exitCode: stopped && code === 0 ? 1 : (code ?? CONNECTION_LOST_EXIT_CODE),
    stdout: stdout.text,
    stderr: stderr.text,
    timedOut: stopper.timedOut,
    aborted: stopper.aborted,
  };
}

async function openCommandChannel(connection: SshCommandConnection, stopper: RemoteStopper) {
  if (stopper.stopped.aborted) {
    return null;
  }

  try {
    return await waitForSshChannel(connection.exec("sh -s", stopper.stopped), stopper.stopped);
  } catch (error) {
    if (error === stopper.stopped.reason) {
      return null;
    }

    throw error;
  }
}

// ssh2's destroy sends a close request. A peer that never acknowledges it must not
// keep the local readers waiting for EOF.
async function* channelOutput(stream: Readable, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  const options = {
    close: ["end", "close"],
    highWaterMark: OUTPUT_QUEUE_HIGH_WATER_MARK,
    lowWaterMark: OUTPUT_QUEUE_LOW_WATER_MARK,
    signal,
  };
  const events = on(stream, "data", options);
  stream.resume();
  for await (const args of events as AsyncIterable<readonly unknown[]>) {
    const chunk = args[0];
    if (chunk instanceof Uint8Array) {
      yield chunk;
    }
  }
}

async function collectRemoteOutput(
  channel: ClientChannel,
  { options, script }: { readonly options: RunProcessOptions; readonly script: string },
  stopper: RemoteStopper,
) {
  const limit = options.maxCapturedBytes ?? DEFAULT_MAX_CAPTURED_BYTES;
  const stdout = new CapturedOutput(limit);
  const stderr = new CapturedOutput(limit);
  const closed = once(channel, "close", { signal: stopper.shutdown });
  let awaitingPid = true;
  const drained = Promise.all([
    closed,
    readLines(channelOutput(channel, stopper.shutdown), (line) => {
      stdout.append(line);
      options.onLine?.(line, "stdout");
    }),
    readLines(channelOutput(channel.stderr, stopper.shutdown), (line) => {
      const pid = awaitingPid ? parsePidLine(line) : null;
      awaitingPid = false;

      if (pid != null) {
        stopper.usePid(pid);
        return;
      }

      stderr.append(line);
      options.onLine?.(line, "stderr");
    }),
  ]);
  channel.end(script);
  const [args]: [readonly unknown[], void, void] = await drained.catch((error: unknown) => {
    if (stopper.shutdown.aborted && error instanceof Error && error.name === "AbortError") {
      return [[], undefined, undefined] as const;
    }

    throw error;
  });
  const code = typeof args[0] === "number" ? args[0] : null;
  return { code, stdout, stderr };
}
