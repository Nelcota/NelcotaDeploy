import { describe, expect, test } from "bun:test";

import { parseHttpStatusLine, tunnelTarget } from "./tunnel-probes";

describe("parseHttpStatusLine", () => {
  test.each([
    ["HTTP/1.1 200 OK", 200],
    ["HTTP/1.0 302 Found", 302],
    ["HTTP/2 503", 503],
    ["HTTP/1.1 404 Not Found", 404],
  ])("reads the status of %p", (line, status) => {
    expect(parseHttpStatusLine(line)).toBe(status);
  });

  test.each([[""], ["SSH-2.0-OpenSSH_9.6"], ["HTTP/1.1 20 OK"], ["garbage HTTP/1.1 200 OK"]])(
    "returns null for %p",
    (line) => {
      expect(parseHttpStatusLine(line)).toBeNull();
    },
  );
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
