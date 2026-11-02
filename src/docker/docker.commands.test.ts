import { describe, expect, test } from "bun:test";

import {
  assertFilePath,
  buildImageArgs,
  containerNameFor,
  databaseContainerNameFor,
  databaseVolumeNameFor,
  imageTagFor,
  managedLabels,
  proxyContainerArgs,
  runContainerArgs,
  stopContainerArgs,
  volumeNameFor,
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
  const base = {
    containerName: "app",
    imageTag: "nelcota/api:abc",
    network: "nelcota",
    labels: {},
    environmentKeys: [],
    volumes: [],
  };

  test("enforces memory in MiB and fractional CPU cores", () => {
    const args = runContainerArgs({ ...base, memoryLimitInMb: 128, cpuLimitInMillicores: 250 });

    expect(args.slice(args.indexOf("--memory"), args.indexOf("--memory") + 2)).toEqual([
      "--memory",
      "128m",
    ]);
    expect(args.slice(args.indexOf("--cpus"), args.indexOf("--cpus") + 2)).toEqual([
      "--cpus",
      "0.25",
    ]);
  });

  test("leaves resources unlimited for absent or null limits", () => {
    for (const options of [base, { ...base, memoryLimitInMb: null, cpuLimitInMillicores: null }]) {
      const args = runContainerArgs(options);
      expect(args).not.toContain("--memory");
      expect(args).not.toContain("--cpus");
    }
  });

  test.each([0, -1, 63, 128.5, 1_048_577, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid memory limit %p",
    (memoryLimitInMb) => {
      expect(() => runContainerArgs({ ...base, memoryLimitInMb })).toThrow(
        InvalidDockerArgumentError,
      );
    },
  );

  test.each([0, -1, 99, 250.5, 256_001, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid CPU limit %p",
    (cpuLimitInMillicores) => {
      expect(() => runContainerArgs({ ...base, cpuLimitInMillicores })).toThrow(
        InvalidDockerArgumentError,
      );
    },
  );

  test.each([64, 1_048_576])("accepts memory boundary %p", (memoryLimitInMb) => {
    expect(runContainerArgs({ ...base, memoryLimitInMb })).toContain(`${memoryLimitInMb}m`);
  });

  test.each([100, 256_000])("accepts CPU boundary %p", (cpuLimitInMillicores) => {
    expect(runContainerArgs({ ...base, cpuLimitInMillicores })).toContain("--cpus");
  });

  test("runs detached on the platform network without publishing host ports", () => {
    const args = runContainerArgs({
      containerName: "nelcota-api-abc",
      imageTag: "nelcota/api:abc",
      network: "nelcota",
      labels: managedLabels({
        projectId: "p1",
        projectSlug: "api",
        deploymentId: "d1",
        previewId: null,
      }),
      environmentKeys: ["SECRET_TOKEN"],
      volumes: [],
    });

    expect(args).toContain("--detach");
    expect(args).toContain("nelcota");
    expect(args).not.toContain("--publish");
    expect(args).not.toContain("-p");
    expect(args).toContain("io.nelcota.managed=true");
    expect(args).toContain("traefik.enable=false");
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
        volumes: [],
      });

    expect(run).toThrow(InvalidDockerArgumentError);
  });
});

test("prevents caller labels from enabling Docker-provider routing", () => {
  const args = runContainerArgs({
    containerName: "app",
    imageTag: "nelcota/api:abc",
    network: "nelcota",
    labels: { "traefik.enable": "true" },
    environmentKeys: [],
    volumes: [],
  });
  expect(args).toContain("traefik.enable=false");
  expect(args).not.toContain("traefik.enable=true");
});

test.each([
  "PATH",
  "HOME",
  "LD_PRELOAD",
  "DYLD_INSERT_LIBRARIES",
  "BUILDX_CONFIG",
  "HTTP_PROXY",
  "BASH_ENV",
])("refuses process-control variable %s in Docker arguments", (key) => {
  expect(() =>
    buildImageArgs({
      dockerfilePath: "Dockerfile",
      contextPath: ".",
      imageTag: "nelcota/api:abc",
      labels: {},
      buildArgKeys: [key],
    }),
  ).toThrow(InvalidDockerArgumentError);
  expect(() =>
    runContainerArgs({
      containerName: "app",
      imageTag: "nelcota/api:abc",
      network: "nelcota",
      labels: {},
      environmentKeys: [key],
      volumes: [],
    }),
  ).toThrow(InvalidDockerArgumentError);
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

const RUN_BASE = {
  containerName: "nelcota-api-abc",
  imageTag: "nelcota/api:abc",
  network: "nelcota",
  labels: {},
  environmentKeys: [],
};

describe("runContainerArgs volumes", () => {
  test("mounts each named volume at its path", () => {
    const args = runContainerArgs({
      ...RUN_BASE,
      volumes: [{ name: "nelcota-data-0a1b2c3d4e5f", target: "/app/data" }],
    });

    expect(args).toContain("type=volume,source=nelcota-data-0a1b2c3d4e5f,target=/app/data");
  });

  test.each([["/app/data,readonly"], ["/app/data=x"], ["relative"], ["/"]])(
    "throws InvalidDockerArgumentError for the mount path %p",
    (target) => {
      const run = () =>
        runContainerArgs({ ...RUN_BASE, volumes: [{ name: "nelcota-data-1", target }] });

      expect(run).toThrow(InvalidDockerArgumentError);
    },
  );
});

describe("volumeNameFor", () => {
  test("derives a stable name from the volume id", () => {
    expect(volumeNameFor(DEPLOYMENT_ID)).toBe("nelcota-data-0c1d2e3f4a5b");
  });
});

describe("database names", () => {
  test("derives the container and data volume names from the database id", () => {
    expect(databaseContainerNameFor(DEPLOYMENT_ID)).toBe("nelcota-db-0c1d2e3f4a5b");
    expect(databaseVolumeNameFor(DEPLOYMENT_ID)).toBe("nelcota-dbdata-0c1d2e3f4a5b");
  });

  test("throws InvalidDockerArgumentError for a malformed database id", () => {
    const run = () => databaseContainerNameFor("--rm");

    expect(run).toThrow(InvalidDockerArgumentError);
  });
});

describe("runContainerArgs command", () => {
  test("puts the command after the image", () => {
    const args = runContainerArgs({
      ...RUN_BASE,
      volumes: [],
      command: ["redis-server", "--appendonly", "yes"],
    });

    expect(args.slice(-4)).toEqual([RUN_BASE.imageTag, "redis-server", "--appendonly", "yes"]);
  });

  test("ends with the image when no command is given", () => {
    const args = runContainerArgs({ ...RUN_BASE, volumes: [] });

    expect(args.at(-1)).toBe(RUN_BASE.imageTag);
  });
});

describe("assertFilePath", () => {
  test("accepts an absolute path of plain segments", () => {
    expect(assertFilePath("/tmp/nelcota-backup.dump")).toBe("/tmp/nelcota-backup.dump");
  });

  test.each([["relative"], ["/tmp/../etc"], ["/tmp/a:b"], ["/tmp/a b"]])(
    "throws InvalidDockerArgumentError for %p",
    (path) => {
      expect(() => assertFilePath(path)).toThrow(InvalidDockerArgumentError);
    },
  );
});
