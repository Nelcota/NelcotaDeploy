import { describe, expect, test } from "bun:test";

import { projectRouteConfig, sharedRouteConfig } from "./route-config";
import { InvalidRouteError } from "./routing.errors";

const ENTRYPOINTS = { http: "web", https: "websecure", certResolver: "letsencrypt" };
const BASE = {
  routeName: "api",
  containerNames: ["nelcota-api-0c1d2e3f4a5b"],
  internalPort: 8080,
  entrypoints: ENTRYPOINTS,
  compress: false,
};

describe("projectRouteConfig", () => {
  test("sends every hostname to the one container given", () => {
    const config = projectRouteConfig({
      ...BASE,
      domains: [{ hostname: "api.example.com", httpsEnabled: true }],
    });

    expect(config.http.services).toEqual({
      "nelcota-api": {
        loadBalancer: { servers: [{ url: "http://nelcota-api-0c1d2e3f4a5b:8080" }] },
      },
    });
  });

  test("balances requests between every replica given", () => {
    const config = projectRouteConfig({
      ...BASE,
      containerNames: ["nelcota-api-0c1d2e3f4a5b", "nelcota-api-0c1d2e3f4a5b-2"],
      domains: [{ hostname: "api.example.com", httpsEnabled: true }],
    });

    expect(config.http.services?.["nelcota-api"]?.loadBalancer.servers).toEqual([
      { url: "http://nelcota-api-0c1d2e3f4a5b:8080" },
      { url: "http://nelcota-api-0c1d2e3f4a5b-2:8080" },
    ]);
  });

  test("throws InvalidRouteError without any container", () => {
    const domains = [{ hostname: "api.example.com", httpsEnabled: true }];

    expect(() => projectRouteConfig({ ...BASE, containerNames: [], domains })).toThrow(
      InvalidRouteError,
    );
  });

  test("serves an HTTPS domain with a certificate and redirects its HTTP requests", () => {
    const config = projectRouteConfig({
      ...BASE,
      domains: [{ hostname: "api.example.com", httpsEnabled: true }],
    });

    expect(config.http.routers?.["nelcota-api-0"]).toEqual({
      rule: "Host(`api.example.com`)",
      entryPoints: ["websecure"],
      service: "nelcota-api",
      middlewares: [],
      tls: { certResolver: "letsencrypt" },
    });
    expect(config.http.routers?.["nelcota-api-0-http"]?.middlewares).toEqual([
      "nelcota-https-redirect",
    ]);
  });

  test("serves an HTTP-only domain on the HTTP entrypoint, without a redirect", () => {
    const config = projectRouteConfig({
      ...BASE,
      domains: [{ hostname: "api.local.test", httpsEnabled: false }],
    });

    expect(config.http.routers?.["nelcota-api-0"]?.entryPoints).toEqual(["web"]);
    expect(config.http.routers?.["nelcota-api-0-http"]).toBeUndefined();
  });
});

describe("projectRouteConfig compression", () => {
  test("compresses responses when the proxy does not", () => {
    const config = projectRouteConfig({
      ...BASE,
      compress: true,
      domains: [{ hostname: "api.example.com", httpsEnabled: false }],
    });

    expect(config.http.routers?.["nelcota-api-0"]?.middlewares).toEqual(["nelcota-compress"]);
  });
});

describe("projectRouteConfig names", () => {
  test("keeps a preview's routers apart from production's", () => {
    const config = projectRouteConfig({
      ...BASE,
      routeName: "api-pr-12",
      domains: [{ hostname: "pr-12-api.apps.example.com", httpsEnabled: false }],
    });

    expect(Object.keys(config.http.services ?? {})).toEqual(["nelcota-api-pr-12"]);
    expect(Object.keys(config.http.routers ?? {})).toEqual(["nelcota-api-pr-12-0"]);
  });

  test("throws InvalidRouteError for a name that is not a plain slug", () => {
    expect(() => projectRouteConfig({ ...BASE, routeName: "api.evil", domains: [] })).toThrow(
      InvalidRouteError,
    );
  });
});

describe("projectRouteConfig validation", () => {
  const domains = [{ hostname: "api.example.com", httpsEnabled: true }];

  test.each(["localhost", "api.example.com.", `${"a".repeat(64)}.example.com`])(
    "rejects hostnames outside the shared DNS limits: %s",
    (hostname) => {
      expect(() =>
        projectRouteConfig({ ...BASE, domains: [{ hostname, httpsEnabled: true }] }),
      ).toThrow(InvalidRouteError);
    },
  );

  test("throws InvalidRouteError for a hostname that could widen the rule", () => {
    const config = () =>
      projectRouteConfig({
        ...BASE,
        domains: [{ hostname: "a.com`) || Host(`b.com", httpsEnabled: false }],
      });

    expect(config).toThrow(InvalidRouteError);
  });

  test.each([0, 65_536, 1.5, Number.NaN])("throws InvalidRouteError for port %p", (port) => {
    expect(() => projectRouteConfig({ ...BASE, internalPort: port, domains })).toThrow(
      InvalidRouteError,
    );
  });

  test("throws InvalidRouteError for a container name that is not a plain name", () => {
    expect(() => projectRouteConfig({ ...BASE, containerNames: ["evil.com/x?"], domains })).toThrow(
      InvalidRouteError,
    );
  });

  test("throws InvalidRouteError for an entrypoint that is not a plain name", () => {
    expect(() =>
      projectRouteConfig({ ...BASE, entrypoints: { ...ENTRYPOINTS, http: "web,admin" }, domains }),
    ).toThrow(InvalidRouteError);
  });
});

describe("sharedRouteConfig", () => {
  test("defines the HTTPS redirect every secure domain uses", () => {
    expect(sharedRouteConfig(false).http.middlewares).toEqual({
      "nelcota-https-redirect": { redirectScheme: { scheme: "https" } },
    });
  });

  test("defines compression only where routes compress themselves", () => {
    expect(sharedRouteConfig(true).http.middlewares).toHaveProperty("nelcota-compress");
  });
});
