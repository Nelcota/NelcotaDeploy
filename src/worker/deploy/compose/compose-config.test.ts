import { describe, expect, test } from "bun:test";

import { checkComposeConfig, checkComposeSource } from "./compose-config";
import { InvalidComposeFileError } from "./compose.errors";

const REPOSITORY = "/data/workspaces/api-1234/repository";
const OPTIONS = { routedService: "web", repositoryPath: REPOSITORY };

/** A model as `docker compose config --format json` prints it for a simple app and database. */
function model(web: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return {
    name: "nelcota-0190",
    services: {
      web: {
        build: { context: REPOSITORY, dockerfile: "Dockerfile" },
        networks: { default: null },
        ...web,
      },
      db: {
        image: "postgres:18",
        volumes: [{ type: "volume", source: "data", target: "/var/lib/postgresql" }],
        networks: { default: null },
      },
    },
    networks: { default: { name: "nelcota-0190_default", ipam: {} } },
    volumes: { data: { name: "nelcota-0190_data" } },
    ...extra,
  };
}

function problemsOf(config: unknown): readonly string[] {
  try {
    checkComposeConfig(config, OPTIONS);
  } catch (error) {
    if (error instanceof InvalidComposeFileError) {
      return error.problems;
    }
    throw error;
  }
  return [];
}

describe("checkComposeConfig", () => {
  test("accepts an app built from the repository and a database on a named volume", () => {
    const checked = checkComposeConfig(model(), OPTIONS);

    expect(Object.keys(checked.model.services)).toEqual(["web", "db"]);
    expect(checked.hostPaths).toEqual([REPOSITORY, `${REPOSITORY}/Dockerfile`]);
  });

  test("lists env files and secret files as host paths to resolve", () => {
    const config = model(
      { env_file: [{ path: `${REPOSITORY}/app.env` }] },
      { secrets: { token: { file: `${REPOSITORY}/token.txt` } } },
    );

    const checked = checkComposeConfig(config, OPTIONS);

    expect(checked.hostPaths).toContain(`${REPOSITORY}/app.env`);
    expect(checked.hostPaths).toContain(`${REPOSITORY}/token.txt`);
  });

  test("throws InvalidComposeFileError when the routed service is missing", () => {
    expect(() => checkComposeConfig(model(), { ...OPTIONS, routedService: "api" })).toThrow(
      InvalidComposeFileError,
    );
  });

  test("throws InvalidComposeFileError for a file without services", () => {
    expect(() => checkComposeConfig({ name: "x" }, OPTIONS)).toThrow(InvalidComposeFileError);
  });

  test.each([
    ["privileged", { privileged: true }],
    ["Docker API access", { use_api_socket: true }],
    ["an external provider", { provider: { type: "evil" } }],
    ["privileged startup hooks", { post_start: [{ command: "id", privileged: true }] }],
    ["privileged shutdown hooks", { pre_stop: [{ command: "id", privileged: true }] }],
    ["host credential files", { credential_spec: { file: "/etc/credentials" } }],
    ["label files", { label_file: ["/etc/labels"] }],
    ["published ports", { ports: [{ target: 80, published: "8080" }] }],
    ["added capabilities", { cap_add: ["NET_ADMIN"] }],
    ["devices", { devices: ["/dev/sda:/dev/sda"] }],
    ["security options", { security_opt: ["seccomp:unconfined"] }],
    ["the server's network", { network_mode: "host" }],
    ["another container's network", { network_mode: "container:nelcota-other-1" }],
    ["the server's processes", { pid: "host" }],
    ["the server's IPC", { ipc: "host" }],
    ["the server's user namespace", { userns_mode: "host" }],
    ["a fixed container name", { container_name: "nelcota-api-0c1d2e3f4a5b" }],
    ["another runtime", { runtime: "runc" }],
    ["volumes of other containers", { volumes_from: ["nelcota-db-1"] }],
    ["a bind mount", { volumes: [{ type: "bind", source: "/etc", target: "/host-etc" }] }],
    ["a platform label", { labels: { "io.nelcota.project-id": "someone-else" } }],
    ["build secrets", { build: { context: REPOSITORY, secrets: [{ source: "x" }] } }],
    ["an SSH agent in the build", { build: { context: REPOSITORY, ssh: ["default"] } }],
    ["other build contexts", { build: { context: REPOSITORY, additional_contexts: { x: "/" } } }],
    ["the server's network in the build", { build: { context: REPOSITORY, network: "host" } }],
    ["a remote build context", { build: { context: "https://github.com/acme/api.git" } }],
    [
      "local build cache writes",
      { build: { context: REPOSITORY, cache_to: ["type=local,dest=/etc"] } },
    ],
    [
      "local build cache reads",
      { build: { context: REPOSITORY, cache_from: ["type=local,src=/etc"] } },
    ],
    [
      "extra image tags",
      { build: { context: REPOSITORY, tags: ["nelcota/another-project:live"] } },
    ],
  ])("rejects %s", (_what, web) => {
    expect(problemsOf(model(web)).length).toBeGreaterThan(0);
  });

  test.each([
    ["an env file", { env_file: [{ path: "/proc/1/environ" }] }],
    ["a build context", { build: { context: "/" } }],
    ["a Dockerfile", { build: { context: REPOSITORY, dockerfile: "../../../etc/Dockerfile" } }],
  ])("rejects %s outside the repository", (_what, web) => {
    expect(
      problemsOf(model(web)).some((problem) => problem.includes("outside the repository")),
    ).toBe(true);
  });

  test("rejects a secret read from a file outside the repository", () => {
    const config = model({}, { secrets: { key: { file: "/proc/1/environ" } } });

    expect(problemsOf(config)).toContain("/proc/1/environ is outside the repository");
  });

  test.each([
    ["an external volume", { volumes: { data: { external: true } } }],
    ["a volume driver", { volumes: { data: { driver: "rexray" } } }],
    [
      "volume driver options",
      { volumes: { data: { driver_opts: { type: "none", device: "/" } } } },
    ],
    ["an external network", { networks: { proxy: { external: true } } }],
    ["the host network driver", { networks: { lan: { driver: "host" } } }],
    [
      "host network options",
      { networks: { lan: { driver_opts: { "com.docker.network.bridge.name": "docker0" } } } },
    ],
    ["an external secret", { secrets: { token: { external: true } } }],
    ["an external config", { configs: { settings: { external: true } } }],
    ["a secret from the host environment", { secrets: { key: { environment: "DOCKER_HOST" } } }],
    ["a config from the host environment", { configs: { key: { environment: "DOCKER_CONFIG" } } }],
  ])("rejects %s", (_what, extra) => {
    expect(problemsOf(model({}, extra)).length).toBeGreaterThan(0);
  });

  test("reports every problem at once", () => {
    const problems = problemsOf(model({ privileged: true, ports: [{ target: 80 }] }));

    expect(problems).toHaveLength(2);
  });

  test("allows tmpfs mounts and IPC private to the container", () => {
    const web = { volumes: [{ type: "tmpfs", target: "/tmp" }], ipc: "private" };

    expect(problemsOf(model(web))).toEqual([]);
  });

  test("checks the implicit Dockerfile path against symlinks too", () => {
    const checked = checkComposeConfig(model({ build: { context: REPOSITORY } }), OPTIONS);

    expect(checked.hostPaths).toContain(`${REPOSITORY}/Dockerfile`);
  });
});

describe("checkComposeSource", () => {
  test("rejects label files before Compose can read them", () => {
    const source = "services:\n  web:\n    image: nginx\n    label_file: /etc/secrets\n";

    expect(() => checkComposeSource(source)).toThrow(InvalidComposeFileError);
  });

  test("accepts a file with every service in it", () => {
    expect(() => checkComposeSource("services:\n  web:\n    build: .\n")).not.toThrow();
  });

  test("throws InvalidComposeFileError for a file that includes others", () => {
    expect(() => checkComposeSource("include:\n  - /etc/compose.yaml\nservices: {}\n")).toThrow(
      InvalidComposeFileError,
    );
  });

  test("throws InvalidComposeFileError for a service extended from another file", () => {
    const source =
      "services:\n  web:\n    extends:\n      file: ../other.yaml\n      service: app\n";

    expect(() => checkComposeSource(source)).toThrow(InvalidComposeFileError);
  });

  test("allows a service extended from another service of the same file", () => {
    const source =
      "services:\n  base:\n    image: nginx\n  web:\n    extends:\n      service: base\n";

    expect(() => checkComposeSource(source)).not.toThrow();
  });

  test("throws InvalidComposeFileError for a file that is not a mapping", () => {
    expect(() => checkComposeSource("- just\n- a list\n")).toThrow(InvalidComposeFileError);
  });
});
