import { describe, expect, test } from "bun:test";

import { probeHostname, type ProbeTools, reasonOf } from "./uptime-probe";

const TARGET = { hostname: "api.example.com", httpsEnabled: true };
const PUBLIC_ADDRESS = "93.184.215.14";

function tools(answer: () => Promise<Response>, addresses = [PUBLIC_ADDRESS]) {
  const requested: string[] = [];
  let clock = 1000;
  const probeTools: ProbeTools = {
    lookup: async () => await Promise.resolve(addresses),
    fetch: Object.assign(
      async (input: string | URL | Request) => {
        requested.push(input instanceof Request ? input.url : input.toString());
        clock += 42;
        return await answer();
      },
      { preconnect: fetch.preconnect },
    ),
    now: () => clock,
  };
  return { probeTools, requested };
}

describe("probeHostname", () => {
  test("counts an answered request as up, with its status and time", async () => {
    const { probeTools, requested } = tools(async () => await Promise.resolve(new Response("ok")));

    const result = await probeHostname(TARGET, probeTools);

    expect(result).toEqual({
      kind: "checked",
      up: true,
      statusCode: 200,
      responseTimeInMs: 42,
      reason: null,
    });
    expect(requested).toEqual(["https://api.example.com/"]);
  });

  test("counts a redirect or a missing page as up: the application answered", async () => {
    const { probeTools } = tools(
      async () => await Promise.resolve(new Response(null, { status: 404 })),
    );

    const result = await probeHostname(TARGET, probeTools);

    expect(result).toMatchObject({ up: true, statusCode: 404 });
  });

  test("counts a server error as down", async () => {
    const { probeTools } = tools(
      async () => await Promise.resolve(new Response(null, { status: 503 })),
    );

    const result = await probeHostname(TARGET, probeTools);

    expect(result).toMatchObject({ up: false, statusCode: 503, reason: "server-error" });
  });

  test("uses plain HTTP for a hostname without HTTPS", async () => {
    const { probeTools, requested } = tools(async () => await Promise.resolve(new Response()));

    await probeHostname({ ...TARGET, httpsEnabled: false }, probeTools);

    expect(requested).toEqual(["http://api.example.com/"]);
  });

  test("counts a hostname that does not resolve as down", async () => {
    const { probeTools, requested } = tools(async () => await Promise.resolve(new Response()), []);

    const result = await probeHostname(TARGET, probeTools);

    expect(result).toMatchObject({ up: false, reason: "dns" });
    expect(requested).toEqual([]);
  });

  test.each([["127.0.0.1"], ["10.0.0.5"], ["169.254.169.254"], ["::1"], ["192.168.1.1"]])(
    "never requests a hostname resolving to the private address %s",
    async (address) => {
      const { probeTools, requested } = tools(
        async () => await Promise.resolve(new Response()),
        [PUBLIC_ADDRESS, address],
      );

      const result = await probeHostname(TARGET, probeTools);

      expect(result).toEqual({ kind: "private" });
      expect(requested).toEqual([]);
    },
  );

  test("counts a request that fails as down", async () => {
    const { probeTools } = tools(async () => await Promise.reject(new Error("ECONNREFUSED")));

    const result = await probeHostname(TARGET, probeTools);

    expect(result).toMatchObject({ up: false, reason: "connection", statusCode: null });
  });
});

describe("reasonOf", () => {
  test("recognizes a timeout", () => {
    expect(reasonOf(new DOMException("timed out", "TimeoutError"))).toBe("timeout");
  });

  test("recognizes a certificate problem", () => {
    expect(reasonOf(Object.assign(new Error("bad"), { code: "CERT_HAS_EXPIRED" }))).toBe(
      "certificate",
    );
  });

  test("reports anything else as a connection problem", () => {
    expect(reasonOf("something")).toBe("connection");
  });
});
