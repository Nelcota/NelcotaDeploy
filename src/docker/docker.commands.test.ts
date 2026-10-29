import { describe, expect, test } from "bun:test";

import {
  buildImageArgs,
  containerNameFor,
  imageTagFor,
  managedLabels,
  proxyContainerArgs,
  runContainerArgs,
  stopContainerArgs,
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

const PROXY_BASE = {
  network: "nelcota",
  httpEntrypoint: "web",
  httpsEntrypoint: "websecure",
  certResolver: "letsencrypt",
  acmeEmail: "ops@example.com",
  routesDirectory: "/var/lib/nelcota/routes",
};

describe("proxyContainerArgs", () => {
  test("publishes ports 80 and 443 and routes only platform containers", () => {
    const args = proxyContainerArgs(PROXY_BASE);

    expect(args).toContain("80:80");
    expect(args).toContain("443:443");
    expect(args).toContain("io.nelcota.proxy=true");
    expect(args).toContain("--providers.docker.constraints=Label(`io.nelcota.managed`,`true`)");
    expect(args).toContain("--certificatesresolvers.letsencrypt.acme.email=ops@example.com");
  });

  test("reads application routes from the route directory, read-only", () => {
    const args = proxyContainerArgs(PROXY_BASE);

    expect(args).toContain("/var/lib/nelcota/routes:/routes:ro");
    expect(args).toContain("--providers.file.directory=/routes");
    expect(args).toContain("io.nelcota.proxy-version=2");
  });

  test.each([["relative"], ["/var/lib/../etc"], ["/var/lib/nelcota/routes:/etc"]])(
    "throws InvalidDockerArgumentError for the route directory %p",
    (routesDirectory) => {
      expect(() => proxyContainerArgs({ ...PROXY_BASE, routesDirectory })).toThrow(
        InvalidDockerArgumentError,
      );
    },
  );

  test("creates the certificate account without an e-mail when none is set", () => {
    const args = proxyContainerArgs({ ...PROXY_BASE, acmeEmail: null });

    expect(args.some((arg) => arg.includes("acme.email"))).toBe(false);
  });

  test("throws InvalidDockerArgumentError for an e-mail that could inject a flag", () => {
    const args = () => proxyContainerArgs({ ...PROXY_BASE, acmeEmail: "a@b.c --api.insecure" });

    expect(args).toThrow(InvalidDockerArgumentError);
  });

  test("throws InvalidDockerArgumentError for a malformed entrypoint name", () => {
    const args = () => proxyContainerArgs({ ...PROXY_BASE, httpEntrypoint: "web.address=:81" });

    expect(args).toThrow(InvalidDockerArgumentError);
  });
});

describe("stopContainerArgs", () => {
  test("leaves the grace period to Docker when none is given", () => {
    expect(stopContainerArgs("abc123")).toEqual(["container", "stop", "abc123"]);
  });

  test("gives the app the grace period to finish", () => {
    expect(stopContainerArgs("abc123", 30)).toEqual([
      "container",
      "stop",
      "--time",
      "30",
      "abc123",
    ]);
  });

  test.each([-1, 301, 1.5, Number.NaN])(
    "throws InvalidDockerArgumentError for a grace period of %p",
    (grace) => {
      expect(() => stopContainerArgs("abc123", grace)).toThrow(InvalidDockerArgumentError);
    },
  );

  test("throws InvalidDockerArgumentError for an id that could be read as an option", () => {
    expect(() => stopContainerArgs("--all")).toThrow(InvalidDockerArgumentError);
  });
});
