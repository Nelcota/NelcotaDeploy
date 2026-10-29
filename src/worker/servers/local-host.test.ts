import { describe, expect, test } from "bun:test";

import { getConfig, InvalidConfigError } from "@/config";

import { createLocalHost } from "./local-host";

function configWith(changes: { readonly enabled: boolean; readonly routesDir: string | null }) {
  const config = structuredClone(getConfig());
  config.TRAEFIK_ENABLED = changes.enabled;
  delete config.TRAEFIK_ROUTES_DIR;
  if (changes.routesDir != null) {
    config.TRAEFIK_ROUTES_DIR = changes.routesDir;
  }
  return config;
}

describe("createLocalHost", () => {
  test("routes nothing while the panel's proxy is disabled", () => {
    const host = createLocalHost(configWith({ enabled: false, routesDir: null }), "local");

    expect(host.routes).toBeNull();
  });

  test("writes routes where the panel's proxy reads them", () => {
    const host = createLocalHost(configWith({ enabled: true, routesDir: "/routes" }), "local");

    expect(host.routes).not.toBeNull();
  });

  test("throws InvalidConfigError when the proxy is enabled without a route directory", () => {
    expect(() => createLocalHost(configWith({ enabled: true, routesDir: null }), "local")).toThrow(
      InvalidConfigError,
    );
  });
});
