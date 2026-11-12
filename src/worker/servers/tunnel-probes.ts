import type { ClientChannel } from "ssh2";

import { type SshConnection, waitForSshChannel } from "@/remote";

import { HTTP_SUCCESS_LIMIT, PROBE_TIMEOUT_IN_MS, type Probes } from "../probes";

const MAX_STATUS_LINE_LENGTH = 1024;
const MAX_RESPONSE_HEAD_BYTES = 8192;
const LINE_END = "\r\n";
const HEAD_END = "\r\n\r\n";
const FIRST_HTTP_STATUS = 100;
const SWITCHING_PROTOCOLS = 101;
const FIRST_FINAL_HTTP_STATUS = 200;
const LAST_HTTP_STATUS = 599;
const DEFAULT_HTTP_PORT = 80;
const STATUS_LINE_PATTERN = /^HTTP\/\d(?:\.\d)? (\d{3})(?: |$)/;

/**
 * Reads the status code from the first line of an HTTP response.
 *
 * @param line - First response line, such as "HTTP/1.1 200 OK".
 * @returns The status code, or null when the line is not an HTTP status line.
 */
export function parseHttpStatusLine(line: string): number | null {
  if (line.length > MAX_STATUS_LINE_LENGTH) {
    return null;
  }

  const match = STATUS_LINE_PATTERN.exec(line);
  if (match?.[1] == null) {
    return null;
  }
  const status = Number(match[1]);
  return status >= FIRST_HTTP_STATUS && status <= LAST_HTTP_STATUS ? status : null;
}

/** Returns undefined while a complete final status could still arrive. */
function finalStatus(response: string): number | null | undefined {
  let offset = 0;
  for (;;) {
    const end = response.indexOf(LINE_END, offset);
    if (end === -1) {
      const length = response.length - offset;
      return length >= MAX_STATUS_LINE_LENGTH + LINE_END.length ? null : undefined;
    }

    const status = parseHttpStatusLine(response.slice(offset, end));
    if (status == null || status >= FIRST_FINAL_HTTP_STATUS || status === SWITCHING_PROTOCOLS) {
      return status;
    }

    const endOfHeaders = response.indexOf(HEAD_END, end);
    if (endOfHeaders === -1) {
      return undefined;
    }

    offset = endOfHeaders + HEAD_END.length;
  }
}

/** Reads a bounded response head until the final status, channel closure or deadline. */
async function readHttpStatus(stream: ClientChannel, signal: AbortSignal): Promise<number | null> {
  if (signal.aborted) {
    return null;
  }

  const { promise, resolve } = Promise.withResolvers<number | null>();
  let received = "";
  const onEnd = () => resolve(null);
  const onData = (chunk: Buffer) => {
    const remaining = MAX_RESPONSE_HEAD_BYTES - received.length;
    received += chunk.toString("latin1", 0, Math.min(remaining, chunk.byteLength));
    const status = finalStatus(received);
    if (status !== undefined) {
      resolve(status);
      return;
    }

    if (received.length === MAX_RESPONSE_HEAD_BYTES) {
      onEnd();
    }
  };
  signal.addEventListener("abort", onEnd, { once: true });
  stream.on("data", onData);
  stream.once("end", onEnd);
  stream.once("close", onEnd);
  stream.once("error", onEnd);
  using _listeners = {
    [Symbol.dispose]() {
      signal.removeEventListener("abort", onEnd);
      stream.off("data", onData);
      stream.off("end", onEnd);
      stream.off("close", onEnd);
      stream.off("error", onEnd);
    },
  };
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
 * Health probes that run from inside a remote server, through SSH tunnels on the server's
 * connection. Containers there are only reachable on that server's Docker network.
 *
 * @param connection - Connection to the server.
 * @returns TCP and HTTP probes with the same contract as the local ones.
 */
export function tunnelProbes(connection: Pick<SshConnection, "forwardOut">): Probes {
  return {
    async tcp(host, port) {
      try {
        const signal = AbortSignal.timeout(PROBE_TIMEOUT_IN_MS);
        const tunnel = await waitForSshChannel(connection.forwardOut(host, port), signal);
        tunnel.destroy();
        return true;
      } catch {
        return false;
      }
    },
    async http(url) {
      try {
        const target = tunnelTarget(url);
        const signal = AbortSignal.timeout(PROBE_TIMEOUT_IN_MS);
        const tunnel = await waitForSshChannel(
          connection.forwardOut(target.host, target.port),
          signal,
        );
        using _tunnel = { [Symbol.dispose]: () => tunnel.destroy() };
        const response = readHttpStatus(tunnel, signal);
        tunnel.end(
          `GET ${target.path} HTTP/1.1\r\nHost: ${target.host}\r\nConnection: close\r\n\r\n`,
        );
        const status = await response;
        return status != null && status >= FIRST_FINAL_HTTP_STATUS && status < HTTP_SUCCESS_LIMIT;
      } catch {
        return false;
      }
    },
  };
}
