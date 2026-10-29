import { createHash } from "node:crypto";

import { Client, type ClientChannel } from "ssh2";

import { HostKeyMismatchError, SshConnectionError } from "./remote.errors";

const READY_TIMEOUT_IN_MS = 15_000;
// Keepalives detect a dead link in about a minute instead of waiting for TCP to give up.
const KEEPALIVE_INTERVAL_IN_MS = 15_000;
const KEEPALIVE_COUNT_MAX = 4;

/** Where and as whom to connect. */
export type SshTarget = {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  /** OpenSSH private key text. */
  readonly privateKey: string;
  /** Pinned host key fingerprint; null accepts the first key seen (trust on first use). */
  readonly hostKeyFingerprint: string | null;
};

/**
 * Formats a host key fingerprint the way `ssh-keygen -l` prints it, such as "SHA256:abc…".
 *
 * @param key - Raw public host key bytes.
 * @returns The SHA-256 fingerprint.
 */
function fingerprintOf(key: Uint8Array): string {
  const digest = createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
  return `SHA256:${digest}`;
}

/**
 * One long-lived SSH connection to a server, opened on first use and reopened after it drops.
 *
 * @remarks
 * Every command and tunnel is a channel multiplexed on the same connection, so after the
 * first handshake each one costs well under a millisecond on the network round trip.
 */
export class SshConnection implements Disposable {
  readonly #target: SshTarget;
  #client: Client | null = null;
  #connecting: Promise<Client> | null = null;
  #receivedFingerprint: string | null = null;
  /** Starts as the stored fingerprint; the key of the first login is pinned for reconnects. */
  #pinnedFingerprint: string | null;
  #closed = false;

  constructor(target: SshTarget) {
    this.#target = target;
    this.#pinnedFingerprint = target.hostKeyFingerprint;
  }

  /** Fingerprint of the host key the server presented, once connected. */
  get hostKeyFingerprint(): string | null {
    return this.#receivedFingerprint;
  }

  /**
   * Connects now, or returns at once when already connected.
   *
   * @throws {HostKeyMismatchError} When the server presents a different host key.
   * @throws {SshConnectionError} When the connection or authentication fails.
   */
  async connect(): Promise<void> {
    await this.#ready();
  }

  /**
   * Opens a channel that runs a command.
   *
   * @param command - Command line for the remote login shell.
   * @returns The channel: stdout is the stream itself, stderr is `channel.stderr`.
   * @throws {SshConnectionError} When the connection or the channel cannot be opened.
   */
  async exec(command: string): Promise<ClientChannel> {
    const client = await this.#ready();
    const { promise, resolve, reject } = Promise.withResolvers<ClientChannel>();
    client.exec(command, (error, channel) => {
      if (error != null) {
        reject(
          new SshConnectionError(`Cannot open SSH channel: ${error.message}`, { cause: error }),
        );
        return;
      }
      resolve(channel);
    });
    return await promise;
  }

  /**
   * Opens a TCP connection from the server to an address only the server can reach, such as
   * a container on its Docker network.
   *
   * @param host - Address as seen from the server.
   * @param port - TCP port.
   * @returns A duplex stream to that address.
   * @throws {SshConnectionError} When the server refuses or cannot reach the address.
   */
  async forwardOut(host: string, port: number): Promise<ClientChannel> {
    const client = await this.#ready();
    const { promise, resolve, reject } = Promise.withResolvers<ClientChannel>();
    client.forwardOut("127.0.0.1", 0, host, port, (error, channel) => {
      if (error != null) {
        reject(
          new SshConnectionError(`Cannot reach ${host}:${port}: ${error.message}`, {
            cause: error,
          }),
        );
        return;
      }
      resolve(channel);
    });
    return await promise;
  }

  async #ready(): Promise<Client> {
    if (this.#closed) {
      throw new SshConnectionError(`Connection to ${this.#target.host} was closed`);
    }
    if (this.#client != null) {
      return this.#client;
    }
    this.#connecting ??= this.#open().finally(() => {
      this.#connecting = null;
    });
    return await this.#connecting;
  }

  async #open(): Promise<Client> {
    const target = this.#target;
    const client = new Client();
    const { promise, resolve, reject } = Promise.withResolvers<Client>();
    let mismatch: HostKeyMismatchError | null = null;
    client
      .on("ready", () => {
        if (this.#closed) {
          // Disposed while the handshake was running: nobody will use or close it.
          client.end();
          reject(new SshConnectionError(`Connection to ${target.host} was closed`));
          return;
        }
        // Pinned only once logged in, so a failed attempt never decides which key is trusted.
        this.#pinnedFingerprint ??= this.#receivedFingerprint;
        this.#client = client;
        resolve(client);
      })
      .on("error", (error) => {
        reject(
          mismatch ??
            new SshConnectionError(`SSH connection to ${target.host} failed: ${error.message}`, {
              cause: error,
            }),
        );
      })
      .on("close", () => {
        if (this.#client === client) {
          this.#client = null;
        }
        reject(new SshConnectionError(`SSH connection to ${target.host} closed`));
      })
      .connect({
        host: target.host,
        port: target.port,
        username: target.username,
        privateKey: target.privateKey,
        readyTimeout: READY_TIMEOUT_IN_MS,
        keepaliveInterval: KEEPALIVE_INTERVAL_IN_MS,
        keepaliveCountMax: KEEPALIVE_COUNT_MAX,
        hostVerifier: (key: Buffer) => {
          mismatch = this.#verifyHostKey(key);
          return mismatch == null;
        },
      });
    return await promise;
  }

  /** Records the key the server presented and rejects one that differs from the pinned key. */
  #verifyHostKey(key: Buffer): HostKeyMismatchError | null {
    const received = fingerprintOf(key);
    this.#receivedFingerprint = received;
    const expected = this.#pinnedFingerprint;
    if (expected == null || expected === received) {
      return null;
    }
    return new HostKeyMismatchError(this.#target.host, expected, received);
  }

  /** Closes the connection; later calls fail instead of reconnecting. */
  [Symbol.dispose](): void {
    this.#closed = true;
    this.#client?.end();
    this.#client = null;
  }
}
