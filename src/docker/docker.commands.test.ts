import { describe, expect, test } from "bun:test";

import {
  buildImageArgs,
  containerNameFor,
  imageTagFor,
  managedLabels,
  runContainerArgs,
  traefikLabels,
} from "./docker.commands";
import { InvalidDockerArgumentError } from "./docker.errors";

const DEPLOYMENT_ID = "019a2b3c-4d5e-7f60-8a9b-0c1d2e3f4a5b";

describe("deterministic names", () => {
  test("derives image tag and container name from slug and deployment id", () => {
    expect(imageTagFor("api", DEPLOYMENT_ID)).toBe("nelcota/api:0c1d2e3f4a5b");
    expect(containerNameFor("api", DEPLOYMENT_ID)).toBe("nelcota-api-0c1d2e3f4a5b");
  });

  test("throws InvalidDockerArgumentError for a slug that could inject options", () => {
    expect(() => imageTagFor("--privileged", DEPLOYMENT_ID)).toThrow(InvalidDockerArgumentError);
  });
});

describe("buildImageArgs", () => {
  test("passes build arguments by name only, never their values", () => {
    const args = buildImageArgs({
      dockerfilePath: "/w/repo/Dockerfile",
      contextPath: "/w/repo",
      imageTag: "nelcota/api:abc",
      labels: { "io.nelcota.managed": "true" },
      buildArgKeys: ["API_URL"],
    });

    expect(args).toContain("--build-arg");
    expect(args).toContain("API_URL");
    expect(args.some((arg) => arg.includes("="))).toBe(true);
    expect(args.at(-2)).toBe("--");
    expect(args.at(-1)).toBe("/w/repo");
  });

  test("throws InvalidDockerArgumentError for a malformed build argument name", () => {
    const build = () =>
      buildImageArgs({
        dockerfilePath: "Dockerfile",
        contextPath: ".",
        imageTag: "nelcota/api:abc",
        labels: {},
        buildArgKeys: ["A=B"],
      });

    expect(build).toThrow(InvalidDockerArgumentError);
  });

  test("throws InvalidDockerArgumentError for a label value with a line break", () => {
    const build = () =>
      buildImageArgs({
        dockerfilePath: "Dockerfile",
        contextPath: ".",
        imageTag: "nelcota/api:abc",
        labels: { "io.nelcota.project-slug": "a\nb" },
        buildArgKeys: [],
      });

    expect(build).toThrow(InvalidDockerArgumentError);
  });
});

describe("runContainerArgs", () => {
  test("runs detached on the platform network without publishing host ports", () => {
    const args = runContainerArgs({
      containerName: "nelcota-api-abc",
      imageTag: "nelcota/api:abc",
      network: "nelcota",
      labels: managedLabels({ projectId: "p1", projectSlug: "api", deploymentId: "d1" }),
      environmentKeys: ["SECRET_TOKEN"],
    });

    expect(args).toContain("--detach");
    expect(args).toContain("nelcota");
    expect(args).not.toContain("--publish");
    expect(args).not.toContain("-p");
    expect(args).toContain("io.nelcota.managed=true");
    expect(args.join(" ")).toContain("--env SECRET_TOKEN");
    expect(args.at(-1)).toBe("nelcota/api:abc");
  });

  test("throws InvalidDockerArgumentError for an image reference starting with a dash", () => {
    const run = () =>
      runContainerArgs({
        containerName: "x",
        imageTag: "-v:/",
        network: "nelcota",
        labels: {},
        environmentKeys: [],
      });

    expect(run).toThrow(InvalidDockerArgumentError);
  });
});

const TRAEFIK_BASE = {
  projectSlug: "api",
  internalPort: 8080,
  network: "nelcota",
  httpEntrypoint: "web",
  httpsEntrypoint: "websecure",
  certResolver: "letsencrypt",
};

describe("traefikLabels routing", () => {
  const base = TRAEFIK_BASE;

  test("returns no labels when the project has no domains", () => {
    expect(traefikLabels({ ...base, domains: [] })).toEqual({});
  });

  test("routes an HTTPS domain with a certificate and an HTTP redirect", () => {
    const labels = traefikLabels({
      ...base,
      domains: [{ hostname: "api.example.com", httpsEnabled: true }],
    });

    expect(labels["traefik.http.routers.nelcota-api-0.rule"]).toBe("Host(`api.example.com`)");
    expect(labels["traefik.http.routers.nelcota-api-0.tls.certresolver"]).toBe("letsencrypt");
    expect(labels["traefik.http.routers.nelcota-api-0-http.middlewares"]).toBe(
      "nelcota-https-redirect",
    );
    expect(labels["traefik.http.services.nelcota-api.loadbalancer.server.port"]).toBe("8080");
  });

  test("routes an HTTP-only domain on the web entrypoint", () => {
    const labels = traefikLabels({
      ...base,
      domains: [{ hostname: "api.local.test", httpsEnabled: false }],
    });

    expect(labels["traefik.http.routers.nelcota-api-0.entrypoints"]).toBe("web");
    expect(labels["traefik.http.routers.nelcota-api-0.tls"]).toBeUndefined();
  });
});

describe("traefikLabels validation", () => {
  const base = TRAEFIK_BASE;

  test("throws InvalidDockerArgumentError for a hostname that could break the rule", () => {
    const labels = () =>
      traefikLabels({ ...base, domains: [{ hostname: "a`) || Host(`b", httpsEnabled: false }] });

    expect(labels).toThrow(InvalidDockerArgumentError);
  });

  test.each([0, 65_536, 1.5])("throws InvalidDockerArgumentError for port %p", (internalPort) => {
    const labels = () =>
      traefikLabels({ ...base, internalPort, domains: [{ hostname: "a.b", httpsEnabled: false }] });

    expect(labels).toThrow(InvalidDockerArgumentError);
  });
});
