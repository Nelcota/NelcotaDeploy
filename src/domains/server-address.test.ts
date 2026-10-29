import { describe, expect, test } from "bun:test";

import { isPublicIpAddress, lookupAllWithTimeout, resolvePublicAddress } from "./server-address";

describe("isPublicIpAddress", () => {
  test.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "2606:4700::1"])(
    "accepts the public address %p",
    (address) => {
      expect(isPublicIpAddress(address)).toBe(true);
    },
  );

  test.each([
    "127.0.0.1",
    "10.0.0.5",
    "192.168.1.20",
    "172.16.0.1",
    "172.31.255.255",
    "100.64.0.1",
    "169.254.1.1",
    "0.0.0.0",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "192.0.2.5",
    "198.18.0.1",
    "224.0.0.1",
    "not an ip",
  ])("rejects %p", (address) => {
    expect(isPublicIpAddress(address)).toBe(false);
  });
});

describe("resolvePublicAddress", () => {
  const resolvesTo = (address: string) => async () => await Promise.resolve({ address });

  test("returns the public address the hostname resolves to", async () => {
    const address = await resolvePublicAddress("https://deploy.exemplo.com", resolvesTo("1.1.1.1"));

    expect(address).toBe("1.1.1.1");
  });

  test("returns an IP written in the URL without a lookup", async () => {
    const address = await resolvePublicAddress("http://8.8.8.8:3000", () =>
      Promise.reject(new Error("lookup must not run")),
    );

    expect(address).toBe("8.8.8.8");
  });

  test("returns null for a hostname that resolves to a private address", async () => {
    const address = await resolvePublicAddress("http://localhost:3000", resolvesTo("127.0.0.1"));

    expect(address).toBeNull();
  });

  test("returns null when the lookup fails", async () => {
    const address = await resolvePublicAddress("https://deploy.exemplo.com", () =>
      Promise.reject(new Error("ENOTFOUND")),
    );

    expect(address).toBeNull();
  });

  test("returns null for text that is not a URL", async () => {
    const address = await resolvePublicAddress("not a url", resolvesTo("1.1.1.1"));

    expect(address).toBeNull();
  });
});

describe("lookupAllWithTimeout", () => {
  test("resolves every address of a name", async () => {
    const addresses = await lookupAllWithTimeout("localhost");

    expect(addresses.some((address) => address === "127.0.0.1" || address === "::1")).toBe(true);
  });

  test("returns no address for a name that cannot exist", async () => {
    expect(await lookupAllWithTimeout("nelcota.invalid")).toEqual([]);
  });
});
