import { describe, expect, test } from "bun:test";

import type { ComposeModel } from "./compose-config";
import { composeFileFor, type ComposeFileOptions } from "./compose-file";

const MODEL: ComposeModel = {
  services: {
    web: {
      build: { context: "/repo", labels: { team: "api" } },
      environment: { NODE_ENV: "production", DATABASE_URL: "postgres://local" },
      labels: { team: "api" },
      networks: { default: null },
    },
    worker: { image: "acme/worker", restart: "on-failure", networks: { default: null } },
  },
  volumes: { data: { name: "nelcota-0190_data" } },
  networks: { default: { name: "nelcota-0190_default" } },
  other: { name: "nelcota-0190" },
};

const OPTIONS: ComposeFileOptions = {
  projectName: "nelcota-0190",
  routedService: "web",
  network: "nelcota",
  projectLabels: { "io.nelcota.managed": "true", "io.nelcota.project-id": "p1" },
  routedLabels: { "io.nelcota.deployment-id": "d1" },
  environmentKeys: ["DATABASE_URL", "API_TOKEN"],
  memoryLimitInMb: null,
  cpuLimitInMillicores: null,
};

function serviceOf(file: Record<string, unknown>, name: string): Record<string, unknown> {
  const services = file["services"] as Record<string, Record<string, unknown>>;
  return services[name] ?? {};
}

describe("composeFileFor", () => {
  test("scopes custom resource names and built images to their owning project", () => {
    const model = {
      ...MODEL,
      services: { web: { build: { context: "/repo" }, image: "nelcota/other:live" } },
      volumes: { data: { name: "nelcota-data-other" } },
      networks: { default: { name: "nelcota-other" } },
    };

    const file = composeFileFor(model, OPTIONS);

    expect(serviceOf(file, "web")["image"]).toBe("nelcota-0190-web");
    expect(file["volumes"]).toMatchObject({ data: { name: "nelcota-0190_data" } });
    expect(file["networks"]).toMatchObject({ default: { name: "nelcota-0190_default" } });
  });

  test("labels every service as the project's and only the routed one with its deployment", () => {
    const file = composeFileFor(MODEL, OPTIONS);

    expect(serviceOf(file, "web")["labels"]).toEqual({
      team: "api",
      "io.nelcota.managed": "true",
      "io.nelcota.project-id": "p1",
      "io.nelcota.deployment-id": "d1",
      "traefik.enable": "false",
    });
    expect(serviceOf(file, "worker")["labels"]).toEqual({
      ...OPTIONS.projectLabels,
      "traefik.enable": "false",
    });
  });

  test("puts every service on the platform network as well as its own", () => {
    const file = composeFileFor(MODEL, OPTIONS);

    expect(serviceOf(file, "worker")["networks"]).toEqual({
      default: null,
      "nelcota-platform": null,
    });
    expect(file["networks"]).toMatchObject({
      "nelcota-platform": { name: "nelcota", external: true },
    });
  });

  test("passes the project's variables by name, keeping a value the service sets itself", () => {
    const file = composeFileFor(MODEL, OPTIONS);

    expect(serviceOf(file, "web")["environment"]).toEqual({
      API_TOKEN: null,
      DATABASE_URL: "postgres://local",
      NODE_ENV: "production",
    });
  });

  test("restarts services unless stopped, keeping a policy the file sets", () => {
    const file = composeFileFor(MODEL, OPTIONS);

    expect(serviceOf(file, "web")["restart"]).toBe("unless-stopped");
    expect(serviceOf(file, "worker")["restart"]).toBe("on-failure");
  });

  test("labels the images the services build and the volumes and networks Compose creates", () => {
    const file = composeFileFor(MODEL, OPTIONS);

    expect(serviceOf(file, "web")["build"]).toMatchObject({
      labels: { team: "api", "io.nelcota.project-id": "p1" },
    });
    expect(file["volumes"]).toEqual({
      data: { name: "nelcota-0190_data", labels: OPTIONS.projectLabels },
    });
    expect(file["networks"]).toMatchObject({
      default: { name: "nelcota-0190_default", labels: OPTIONS.projectLabels },
    });
  });

  test("applies the project's limits to each service", () => {
    const file = composeFileFor(MODEL, {
      ...OPTIONS,
      memoryLimitInMb: 512,
      cpuLimitInMillicores: 1500,
    });

    expect(serviceOf(file, "worker")).toMatchObject({ mem_limit: "512m", cpus: 1.5 });
  });

  test("keeps the other top-level settings of the model", () => {
    expect(composeFileFor(MODEL, OPTIONS)["name"]).toBe("nelcota-0190");
  });

  test("throws when the file already has a network named like the platform's", () => {
    const model = { ...MODEL, networks: { "nelcota-platform": {} } };

    expect(() => composeFileFor(model, OPTIONS)).toThrow();
  });
});
