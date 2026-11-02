import type { ClientChannel } from "ssh2";

import { quoteForShell } from "./remote-script";
import { RemoteFileError } from "./remote.errors";
import type { SshConnection } from "./ssh-connection";

// Absolute, with no ".." segment and only plain characters, like the directories the platform
// creates on servers.
const FILE_PATH_PATTERN = /^(?:\/(?!\.\.(?:\/|$))[A-Za-z0-9._-]+)+$/;

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

/** Waits for a channel to finish and returns its exit code; null when the connection dropped. */
async function exitCodeOf(channel: ClientChannel, timeoutInMs: number): Promise<number | null> {
  const exit = Promise.withResolvers<number | null>();
  const timer = setTimeout(() => {
    channel.close();
    exit.reject(new RemoteFileError(`File transfer timed out after ${timeoutInMs} ms`));
  }, timeoutInMs);
  channel.on("exit", (code: number | null) => exit.resolve(code));
  channel.on("close", () => exit.resolve(null));
  try {
    return await exit.promise;
  } finally {
    clearTimeout(timer);
  }
}

/** Collects a stream and returns a function giving its last line, or a fallback when empty. */
function collectReason(stream: NodeJS.ReadableStream): () => string {
  const chunks: Buffer[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  return () => {
    const lastLine = Buffer.concat(chunks).toString("utf8").trim().split("\n").at(-1) ?? "";
    return lastLine === "" ? "connection lost" : lastLine;
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
    const channel = await this.#connection.exec(
      `cat -- ${quoteForShell(assertServerFilePath(path))}`,
    );
    // Mutated by the data handler, so it is read through an object.
    const received = { chunks: [] as Buffer[], size: 0, tooLarge: false };
    channel.on("data", (chunk: Buffer) => {
      received.size += chunk.length;
      if (received.size > limits.maxBytes) {
        received.tooLarge = true;
        channel.close();
        return;
      }
      received.chunks.push(chunk);
    });
    const reason = collectReason(channel.stderr);
    const code = await exitCodeOf(channel, limits.timeoutInMs);
    if (received.tooLarge) {
      throw new RemoteFileError(`File ${path} is larger than ${limits.maxBytes} bytes`);
    }
    if (code !== 0) {
      throw new RemoteFileError(`Cannot read ${path}: ${reason()}`);
    }
    return new Uint8Array(Buffer.concat(received.chunks));
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
    const channel = await this.#connection.exec(
      `cat > ${quoteForShell(assertServerFilePath(path))}`,
    );
    const reason = collectReason(channel.stderr);
    const exit = exitCodeOf(channel, timeoutInMs);
    channel.end(Buffer.from(data));
    const code = await exit;
    if (code !== 0) {
      throw new RemoteFileError(`Cannot write ${path}: ${reason()}`);
    }
  }
}
