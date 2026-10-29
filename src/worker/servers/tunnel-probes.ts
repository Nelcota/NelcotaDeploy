import type { ClientChannel } from "ssh2";

import type { SshConnection } from "@/remote";

import type { Probes } from "../probes";

const PROBE_TIMEOUT_IN_MS = 3000;
const HTTP_SUCCESS_LIMIT = 400;
const MAX_STATUS_LINE_LENGTH = 1024;
const DEFAULT_HTTP_PORT = 80;
const STATUS_LINE_PATTERN = /^HTTP\/\d(?:\.\d)? (\d{3})(?: |$)/;

/**
 * Reads the status code from the first line of an HTTP response.
 *
 * @param line - First response line, such as "HTTP/1.1 200 OK".
 * @returns The status code, or null when the line is not an HTTP status line.
 */
export function parseHttpStatusLine(line: string): number | null {
  const match = STATUS_LINE_PATTERN.exec(line);
  if (match?.[1] == null) {
    return null;
  }
  return Number(match[1]);
}

/** Reads from a stream until the first line ends, the stream closes or the time runs out. */
async function readStatusLine(stream: NodeJS.ReadableStream): Promise<string> {
  const { promise, resolve } = Promise.withResolvers<string>();
  let received = "";
  const timer = setTimeout(() => resolve(received), PROBE_TIMEOUT_IN_MS);
  using _timer = { [Symbol.dispose]: () => clearTimeout(timer) };
  stream.on("data", (chunk: Buffer) => {
    received += chunk.toString("latin1");
    const end = received.indexOf("\r\n");
    if (end !== -1 || received.length > MAX_STATUS_LINE_LENGTH) {
      resolve(end === -1 ? received : received.slice(0, end));
    }
  });
  stream.on("close", () => resolve(received));
  stream.on("error", () => resolve(received));
  return await promise;
}

/**
 * Splits a probe URL into what the tunnel needs. The URL parser drops a default port, so
 * an app on port 80 would otherwise get port 0.
 *
 * @param url - Probe URL such as "http://172.18.0.5:80/health".
 * @returns Address, port and request path.
 */
export function tunnelTarget(url: string): { host: string; port: number; path: string } {
  const parsed = new URL(url);
  const port = parsed.port === "" ? DEFAULT_HTTP_PORT : Number(parsed.port);
  return { host: parsed.hostname, port, path: `${parsed.pathname}${parsed.search}` };
}

/**
 * Opens a tunnel, giving up after a few seconds. A tunnel that opens after the deadline is
 * closed at once instead of being left open.
 */
async function openTunnel(
  connection: SshConnection,
  host: string,
  port: number,
): Promise<ClientChannel> {
  const opening = connection.forwardOut(host, port);
  const { promise: timeout, reject } = Promise.withResolvers<never>();
  const timer = setTimeout(() => {
    reject(new Error("probe timed out"));
    opening.then((late) => late.destroy()).catch(() => undefined);
  }, PROBE_TIMEOUT_IN_MS);
  using _timer = { [Symbol.dispose]: () => clearTimeout(timer) };
  return await Promise.race([opening, timeout]);
}

/**
 * Health probes that run from inside a remote server, through SSH tunnels on the server's
 * connection. Containers there are only reachable on that server's Docker network.
 *
 * @param connection - Connection to the server.
 * @returns TCP and HTTP probes with the same contract as the local ones.
 */
export function tunnelProbes(connection: SshConnection): Probes {
  return {
    async tcp(host, port) {
      try {
        const tunnel = await openTunnel(connection, host, port);
        tunnel.destroy();
        return true;
      } catch {
        return false;
      }
    },
    async http(url) {
      try {
        const target = tunnelTarget(url);
        const tunnel = await openTunnel(connection, target.host, target.port);
        tunnel.end(
          `GET ${target.path} HTTP/1.1\r\nHost: ${target.host}\r\nConnection: close\r\n\r\n`,
        );
        const status = parseHttpStatusLine(await readStatusLine(tunnel));
        tunnel.destroy();
        return status != null && status < HTTP_SUCCESS_LIMIT;
      } catch {
        return false;
      }
    },
  };
}
