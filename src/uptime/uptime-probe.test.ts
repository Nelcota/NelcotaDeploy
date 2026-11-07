import { describe, expect, test } from "bun:test";

import { probeHostname, type ProbeTools, reasonOf } from "./uptime-probe";

const TARGET = { hostname: "api.example.com", httpsEnabled: true };
const PUBLIC_ADDRESS = "93.184.215.14";

function tools(answer: () => Promise<Response>, addresses = [PUBLIC_ADDRESS]) {
  const requested: string[] = [];
  const options: (BunFetchRequestInit | undefined)[] = [];
  let clock = 1000;
  const probeTools: ProbeTools = {
    lookup: async () => await Promise.resolve(addresses),
    fetch: Object.assign(
      async (input: string | URL | Request, init?: BunFetchRequestInit) => {
        requested.push(input instanceof Request ? input.url : input.toString());
        options.push(init);
        clock += 42;
        return await answer();
      },
      { preconnect: fetch.preconnect },
    ),
    now: () => clock,
  };
  return { probeTools, requested, options };
}

describe("probeHostname", () => {
  test("pins the checked public IP while preserving the HTTP host and TLS identity", async () => {
    const { probeTools, requested, options } = tools(
      async () => await Promise.resolve(new Response()),
    );

    await probeHostname(TARGET, probeTools);

    expect(requested).toEqual([`https://${PUBLIC_ADDRESS}/`]);
    expect(options[0]).toMatchObject({
      headers: { Host: TARGET.hostname },
      tls: { serverName: TARGET.hostname },
      proxy: false,
      redirect: "manual",
    });
  });

  test("brackets a public IPv6 address", async () => {
    const address = "2606:4700:4700::1111";
    const { probeTools, requested } = tools(
      async () => await Promise.resolve(new Response()),
      [address],
    );

    await probeHostname(TARGET, probeTools);

    expect(requested).toEqual([`https://[${address}]/`]);
  });

  test("tries another checked public address when the first cannot connect", async () => {
    let attempts = 0;
    const { probeTools, requested } = tools(async () => {
      attempts++;
      if (attempts === 1) {
        throw new Error("First address refused the connection");
      }
      return await Promise.resolve(new Response());
    }, [PUBLIC_ADDRESS, "1.1.1.1"]);

    const result = await probeHostname(TARGET, probeTools);

    expect(result).toMatchObject({ up: true });
    expect(requested).toEqual([`https://${PUBLIC_ADDRESS}/`, "https://1.1.1.1/"]);
  });

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
    expect(requested).toEqual([`https://${PUBLIC_ADDRESS}/`]);
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

    expect(requested).toEqual([`http://${PUBLIC_ADDRESS}/`]);
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
