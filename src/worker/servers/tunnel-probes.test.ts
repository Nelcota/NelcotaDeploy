import { describe, expect, spyOn, test } from "bun:test";
import { Duplex } from "node:stream";

import type { ClientChannel } from "ssh2";

import { parseHttpStatusLine, tunnelProbes, tunnelTarget } from "./tunnel-probes";

const PROBE_URL = "http://172.18.0.5:3000/ready";

describe("parseHttpStatusLine", () => {
  test.each([
    ["HTTP/1.1 200 OK", 200],
    ["HTTP/1.0 302 Found", 302],
    ["HTTP/2 503", 503],
    ["HTTP/1.1 404 Not Found", 404],
  ])("reads the status of %p", (line, status) => {
    expect(parseHttpStatusLine(line)).toBe(status);
  });

  test.each([
    [""],
    ["SSH-2.0-OpenSSH_9.6"],
    ["HTTP/1.1 20 OK"],
    ["garbage HTTP/1.1 200 OK"],
    ["HTTP/1.1 099 Invalid"],
    ["HTTP/1.1 600 Invalid"],
  ])("returns null for %p", (line) => {
    expect(parseHttpStatusLine(line)).toBeNull();
  });
});

function tunnelFixture() {
  const written = Promise.withResolvers<void>();
  const stream = new Duplex({
    read() {},
    write(_chunk, _encoding, callback) {
      written.resolve();
      callback();
    },
  });
  const channel = stream as unknown as ClientChannel;
  return {
    channel,
    written: written.promise,
    probes: tunnelProbes({ forwardOut: () => Promise.resolve(channel) }),
  };
}

test.each([
  {
    name: "a final success split across chunks",
    chunks: ["HTTP/1.1 200 OK\r", "\n"],
    healthy: true,
  },
  {
    name: "a redirect with a large body",
    chunks: [`HTTP/1.1 302 Found\r\n${"x".repeat(4000)}`],
    healthy: true,
  },
  { name: "a missing line ending", chunks: ["HTTP/1.1 200 OK"], healthy: false },
  {
    name: "an informational response only",
    chunks: ["HTTP/1.1 103 Early Hints\r\n"],
    healthy: false,
  },
  {
    name: "an informational response followed by a final success",
    chunks: ["HTTP/1.1 103 Early Hints\r\nLink: </ready>\r\n", "\r\nHTTP/1.1 200 OK\r\n"],
    healthy: true,
  },
  {
    name: "an informational response followed by a server failure",
    chunks: ["HTTP/1.1 103 Early Hints\r\n\r\nHTTP/1.1 503 Service Unavailable\r\n"],
    healthy: false,
  },
  { name: "an oversized line", chunks: [`HTTP/1.1 200 ${"x".repeat(4000)}\r\n`], healthy: false },
])("handles $name", async ({ chunks, healthy }) => {
  const { channel, written, probes } = tunnelFixture();
  const outcome = probes.http(PROBE_URL);
  await written;

  for (const chunk of chunks) {
    channel.push(Buffer.from(chunk));
  }

  channel.push(null);
  const result = await outcome;

  expect(result).toBe(healthy);
  expect(channel.destroyed).toBe(true);
  expect(channel.listenerCount("data")).toBe(0);
});

test("uses the opening deadline when waiting for the final status line", async () => {
  const { channel, written, probes } = tunnelFixture();
  const deadline = new AbortController();
  const timeout = spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
  using _timeout = { [Symbol.dispose]: () => timeout.mockRestore() };
  const outcome = probes.http(PROBE_URL);
  await written;

  channel.push(Buffer.from("HTTP/1.1 200 OK"));
  deadline.abort();

  expect(await outcome).toBe(false);
  expect(timeout).toHaveBeenCalledTimes(1);
  expect(channel.destroyed).toBe(true);
});

describe("tunnelTarget", () => {
  test("keeps port 80, which the URL parser drops as the default", () => {
    expect(tunnelTarget("http://172.18.0.5:80/health")).toEqual({
      host: "172.18.0.5",
      port: 80,
      path: "/health",
    });
  });

  test("keeps any other port and the query string", () => {
    expect(tunnelTarget("http://172.18.0.5:3000/ready?full=1")).toEqual({
      host: "172.18.0.5",
      port: 3000,
      path: "/ready?full=1",
    });
  });
});
