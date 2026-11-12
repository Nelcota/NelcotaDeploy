import { once } from "node:events";

import type { ClientChannel } from "ssh2";

import { quoteForShell } from "./remote-script";
import { RemoteFileError } from "./remote.errors";
import { waitForSshChannel } from "./ssh-channel";
import type { SshConnection } from "./ssh-connection";

// Absolute, with no ".." segment and only plain characters, like the directories the platform
// creates on servers.
const FILE_PATH_PATTERN = /^(?:\/(?!\.\.(?:\/|$))[A-Za-z0-9._-]+)+$/;
const MAX_ERROR_BYTES = 4096;
const MAX_TIMER_DELAY_IN_MS = 2_147_483_647;

/**
 * Validates a file path on a server before it reaches a remote shell.
 *
 * @param path - Absolute path.
 * @returns The same path.
 * @throws {RemoteFileError} When the path is relative, climbs with ".." or has unusual
 *   characters.
 */
export function assertServerFilePath(path: string): string {
  if (FILE_PATH_PATTERN.test(path) === false) {
    throw new RemoteFileError(`Invalid file path on the server: ${JSON.stringify(path)}`);
  }
  return path;
}

function transferDeadline(timeoutInMs: number) {
  if (
    Number.isSafeInteger(timeoutInMs) === false ||
    timeoutInMs < 1 ||
    timeoutInMs > MAX_TIMER_DELAY_IN_MS
  ) {
    throw new RemoteFileError(`Invalid remote file transfer timeout: ${timeoutInMs}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new RemoteFileError(`File transfer timed out after ${timeoutInMs} ms`)),
    timeoutInMs,
  );
  return { signal: controller.signal, [Symbol.dispose]: () => clearTimeout(timer) };
}

/** Waits for both streams to finish; ssh2 supplies the process status with close. */
async function exitCodeOf(channel: ClientChannel, signal: AbortSignal): Promise<number | null> {
  try {
    const arguments_: readonly unknown[] = await once(channel, "close", { signal });
    const code = arguments_[0];
    return typeof code === "number" ? code : null;
  } catch (error) {
    signal.throwIfAborted();
    throw error;
  }
}

/** Retains only the tail of stderr so diagnostics cannot consume the transfer budget. */
function collectReason(stream: NodeJS.ReadableStream) {
  let tail: Buffer | undefined;
  let size = 0;
  const onData = (chunk: Buffer) => {
    tail ??= Buffer.alloc(MAX_ERROR_BYTES);
    const bytes = Math.min(chunk.byteLength, MAX_ERROR_BYTES);
    const retained = Math.min(size, MAX_ERROR_BYTES - bytes);
    tail.copyWithin(0, size - retained, size);
    tail.set(chunk.subarray(chunk.byteLength - bytes), retained);
    size = retained + bytes;
  };
  stream.on("data", onData);
  return {
    reason() {
      const lastLine = tail?.toString("utf8", 0, size).trim().split("\n").at(-1) ?? "";
      return lastLine === "" ? "connection lost" : lastLine;
    },
    [Symbol.dispose]: () => stream.off("data", onData),
  };
}

/**
 * Reads and writes whole files on a server over SSH, as raw bytes. The command runner carries
 * text lines only, so binary files such as database dumps travel through here.
 */
export class RemoteFiles {
  readonly #connection: Pick<SshConnection, "exec">;

  /**
   * Reaches the files of one server.
   *
   * @param connection - Connection to the server.
   */
  constructor(connection: Pick<SshConnection, "exec">) {
    this.#connection = connection;
  }

  /**
   * Reads a file.
   *
   * @param path - Absolute path on the server.
   * @param limits - `maxBytes` read before giving up, and `timeoutInMs` for the transfer.
   * @returns The file's bytes.
   * @throws {RemoteFileError} When the path is invalid, the file cannot be read, is larger
   *   than `maxBytes` or the transfer times out.
   */
  async read(
    path: string,
    limits: { readonly maxBytes: number; readonly timeoutInMs: number },
  ): Promise<Uint8Array<ArrayBuffer>> {
    if (Number.isSafeInteger(limits.maxBytes) === false || limits.maxBytes < 1) {
      throw new RemoteFileError(`Invalid remote file read limit: ${limits.maxBytes}`);
    }

    const command = `cat -- ${quoteForShell(assertServerFilePath(path))}`;
    using deadline = transferDeadline(limits.timeoutInMs);
    const channel = await waitForSshChannel(this.#connection.exec(command), deadline.signal);
    using _channel = { [Symbol.dispose]: () => channel.destroy() };
    const byteLimit = new AbortController();
    const signal = AbortSignal.any([deadline.signal, byteLimit.signal]);
    const exit = exitCodeOf(channel, signal);
    using stderr = collectReason(channel.stderr);
    const chunks: Buffer[] = [];
    let size = 0;
    const onData = (chunk: Buffer) => {
      if (signal.aborted) {
        return;
      }

      if (chunk.byteLength > limits.maxBytes - size) {
        byteLimit.abort(
          new RemoteFileError(`File ${path} is larger than ${limits.maxBytes} bytes`),
        );
        return;
      }

      size += chunk.byteLength;
      chunks.push(chunk);
    };
    channel.on("data", onData);
    using _stdout = { [Symbol.dispose]: () => channel.off("data", onData) };

    const code = await exit;
    if (code !== 0) {
      throw new RemoteFileError(`Cannot read ${path}: ${stderr.reason()}`);
    }

    return Buffer.concat(chunks, size);
  }

  /**
   * Writes a file, replacing it when it exists.
   *
   * @param path - Absolute path on the server; its directory must exist.
   * @param data - The file's bytes.
   * @param timeoutInMs - Time allowed for the transfer.
   * @throws {RemoteFileError} When the path is invalid, the file cannot be written or the
   *   transfer times out.
   */
  async write(path: string, data: Uint8Array, timeoutInMs: number): Promise<void> {
    const command = `cat > ${quoteForShell(assertServerFilePath(path))}`;
    using deadline = transferDeadline(timeoutInMs);
    const channel = await waitForSshChannel(this.#connection.exec(command), deadline.signal);
    using _channel = { [Symbol.dispose]: () => channel.destroy() };
    const exit = exitCodeOf(channel, deadline.signal);
    using stderr = collectReason(channel.stderr);
    channel.resume();
    channel.end(data);
    const code = await exit;
    if (code !== 0) {
      throw new RemoteFileError(`Cannot write ${path}: ${stderr.reason()}`);
    }
  }
}
