import {
  CapturedOutput,
  type CommandRunner,
  DEFAULT_MAX_CAPTURED_BYTES,
  type ProcessResult,
  readLines,
  type RunProcessOptions,
} from "@/process";

import { buildRemoteScript, parsePidLine } from "./remote-script";
import type { SshConnection } from "./ssh-connection";

/** Largest delay `setTimeout` honors; longer ones fire at once. */
const MAX_TIMER_DELAY_IN_MS = 2_147_483_647;
const STOP_TIMEOUT_IN_MS = 10_000;
/** Exit code reported when the connection dropped before the command finished. */
const CONNECTION_LOST_EXIT_CODE = 255;

type ChannelExit = { readonly code: number | null };

/**
 * Kills a remote command and its children over a separate channel. Closing a channel alone
 * does not stop the process, so a cancelled build would otherwise keep running.
 *
 * @remarks
 * sshd starts each channel's command as a session leader, and `exec` keeps that process id,
 * so the negative id reaches the whole process group (git helpers, docker build steps).
 */
async function killRemoteProcess(connection: SshConnection, pid: number): Promise<void> {
  const channel = await connection.exec(
    `kill -KILL -- -${pid} 2>/dev/null || kill -KILL ${pid} 2>/dev/null`,
  );
  const closed = Promise.withResolvers<void>();
  channel.on("close", () => closed.resolve());
  channel.resume();
  channel.stderr.resume();
  channel.end();
  await Promise.race([closed.promise, Bun.sleep(STOP_TIMEOUT_IN_MS)]);
}

/** Stops the remote process once, when the timeout passes or the caller aborts. */
class RemoteStopper implements Disposable {
  readonly #connection: SshConnection;
  readonly #timer: ReturnType<typeof setTimeout> | null;
  readonly #signal: AbortSignal | undefined;
  readonly #onAbort = () => this.stop();
  #pid: number | null = null;
  #stopRequested = false;
  #stopping: Promise<void> | null = null;
  timedOut = false;

  constructor(connection: SshConnection, options: RunProcessOptions) {
    this.#connection = connection;
    this.#signal = options.signal;
    this.#timer =
      options.timeoutInMs > MAX_TIMER_DELAY_IN_MS
        ? null
        : setTimeout(() => {
            this.timedOut = true;
            this.stop();
          }, options.timeoutInMs);
    this.#signal?.addEventListener("abort", this.#onAbort, { once: true });
  }

  /** Records the remote process id; stops it at once if a stop came in before. */
  usePid(pid: number): void {
    this.#pid = pid;
    if (this.#stopRequested) {
      this.stop();
    }
  }

  stop(): void {
    this.#stopRequested = true;
    if (this.#pid == null || this.#stopping != null) {
      return;
    }
    this.#stopping = killRemoteProcess(this.#connection, this.#pid).catch(() => {
      // The connection is gone, and the process loses its output pipe with it.
    });
  }

  get aborted(): boolean {
    return this.#signal?.aborted === true;
  }

  [Symbol.dispose](): void {
    if (this.#timer != null) {
      clearTimeout(this.#timer);
    }
    this.#signal?.removeEventListener("abort", this.#onAbort);
  }
}

/**
 * Creates a {@link CommandRunner} that runs commands on a server over an SSH connection.
 *
 * @remarks
 * Behaves like `runProcess`: same result shape, streamed lines, timeout and abort. The
 * command and its environment go to `sh -s` on stdin (see `buildRemoteScript`). A timeout or
 * abort kills the remote process by id.
 *
 * @param connection - Open or lazily opened connection to the server.
 * @returns The runner.
 */
export function createRemoteRunner(connection: SshConnection): CommandRunner {
  return async (command, options) => await runRemote(connection, command, options);
}

async function runRemote(
  connection: SshConnection,
  command: readonly string[],
  options: RunProcessOptions,
): Promise<ProcessResult> {
  const script = buildRemoteScript({ command, env: options.env, cwd: options.cwd });
  using stopper = new RemoteStopper(connection, options);
  if (stopper.aborted) {
    return { exitCode: 1, stdout: "", stderr: "", timedOut: false, aborted: true };
  }
  const channel = await connection.exec("sh -s");
  const exit = Promise.withResolvers<ChannelExit>();
  channel.on("exit", (code: number | null) => exit.resolve({ code }));
  channel.on("close", () => exit.resolve({ code: null }));
  const limit = options.maxCapturedBytes ?? DEFAULT_MAX_CAPTURED_BYTES;
  const stdout = new CapturedOutput(limit);
  const stderr = new CapturedOutput(limit);
  let awaitingPid = true;
  channel.end(script);
  await Promise.all([
    readLines(channel, (line) => {
      stdout.append(line);
      options.onLine?.(line, "stdout");
    }),
    readLines(channel.stderr, (line) => {
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
  const { code } = await exit.promise;
  const stopped = stopper.timedOut || stopper.aborted;
  return {
    exitCode: code ?? CONNECTION_LOST_EXIT_CODE,
    stdout: stdout.text,
    stderr: code == null && stopped === false ? `${stderr.text}SSH connection lost\n` : stderr.text,
    timedOut: stopper.timedOut,
    aborted: stopper.aborted,
  };
}
