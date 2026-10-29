import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { runProcess } from "@/process";

import { createRemoteRunner } from "./remote-runner";
import { HostKeyMismatchError } from "./remote.errors";
import { SshConnection, type SshTarget } from "./ssh-connection";
import { generateSshKeyPair } from "./ssh-key";

const CONTAINER = `nelcota-ssh-it-${process.pid}`;
const SSH_PORT = 22_000 + (process.pid % 1000);
const SETUP_TIMEOUT_IN_MS = 180_000;
const COMMAND_TIMEOUT_IN_MS = 10_000;
const POLL_INTERVAL_IN_MS = 500;
const SHORT_TIMEOUT_IN_MS = 500;
const KILL_SETTLE_IN_MS = 200;
const ABORT_AFTER_IN_MS = 300;
const keys = generateSshKeyPair();

// Alpine with sshd and a tiny HTTP server, reachable only from inside the container.
const SERVER_SCRIPT = `
set -e
apk add --no-cache openssh busybox-extras procps >/dev/null
ssh-keygen -A >/dev/null
# Alpine disables forwarding; the panel's install script enables it for its own user.
sed -i 's/^AllowTcpForwarding.*/AllowTcpForwarding local/' /etc/ssh/sshd_config
mkdir -p /root/.ssh /www
printf '%s\\n' "$PUBLIC_KEY" > /root/.ssh/authorized_keys
chmod 700 /root/.ssh && chmod 600 /root/.ssh/authorized_keys
echo ok > /www/health
httpd -p 127.0.0.1:8080 -h /www
touch /ready
exec /usr/sbin/sshd -D -e
`;

async function docker(args: string[]): Promise<string> {
  const result = await runProcess(["docker", ...args], { timeoutInMs: SETUP_TIMEOUT_IN_MS });
  if (result.exitCode !== 0) {
    throw new Error(`docker ${args[0] ?? ""} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

// Polls one step at a time until the container finished installing sshd.
async function waitForServer(deadline: number = Date.now() + SETUP_TIMEOUT_IN_MS): Promise<void> {
  if (Date.now() >= deadline) {
    throw new Error("SSH test server did not start");
  }
  const check = await runProcess(["docker", "exec", CONTAINER, "test", "-f", "/ready"], {
    timeoutInMs: COMMAND_TIMEOUT_IN_MS,
  });
  if (check.exitCode === 0) {
    return;
  }
  await Bun.sleep(POLL_INTERVAL_IN_MS);
  await waitForServer(deadline);
}

function target(overrides: Partial<SshTarget> = {}): SshTarget {
  return {
    host: "127.0.0.1",
    port: SSH_PORT,
    username: "root",
    privateKey: keys.privateKey,
    hostKeyFingerprint: null,
    ...overrides,
  };
}

let connection: SshConnection;

beforeAll(async () => {
  await docker([
    "run",
    "--detach",
    "--rm",
    "--name",
    CONTAINER,
    "--publish",
    `127.0.0.1:${SSH_PORT}:22`,
    "--env",
    `PUBLIC_KEY=${keys.publicKey}`,
    "alpine:3.24",
    "sh",
    "-c",
    SERVER_SCRIPT,
  ]);
  await waitForServer();
  connection = new SshConnection(target());
}, SETUP_TIMEOUT_IN_MS);

afterAll(async () => {
  connection[Symbol.dispose]();
  await runProcess(["docker", "rm", "--force", CONTAINER], { timeoutInMs: SETUP_TIMEOUT_IN_MS });
});

describe("remote runner over SSH", () => {
  test("returns output, exit code and streamed lines like a local process", async () => {
    const run = createRemoteRunner(connection);
    const lines: string[] = [];

    const result = await run(["sh", "-c", "echo out; echo err >&2; exit 3"], {
      timeoutInMs: COMMAND_TIMEOUT_IN_MS,
      onLine: (line, stream) => lines.push(`${stream}:${line}`),
    });

    expect(result.exitCode).toBe(3);
    expect(result.stdout).toBe("out\n");
    expect(result.stderr).toBe("err\n");
    expect(lines.toSorted()).toEqual(["stderr:err", "stdout:out"]);
  });

  test("passes environment values and the working directory without a shell reading them", async () => {
    const run = createRemoteRunner(connection);

    const result = await run(["sh", "-c", 'printf "%s|%s" "$VALUE" "$(pwd)"'], {
      timeoutInMs: COMMAND_TIMEOUT_IN_MS,
      env: { VALUE: "it's $(id) `id`" },
      cwd: "/tmp",
    });

    expect(result.stdout).toBe("it's $(id) `id`|/tmp\n");
  });
});

describe("stopping remote commands", () => {
  test("kills the remote process when the timeout passes", async () => {
    const run = createRemoteRunner(connection);

    const result = await run(["sleep", "37"], { timeoutInMs: SHORT_TIMEOUT_IN_MS });
    await Bun.sleep(KILL_SETTLE_IN_MS);
    const remaining = await run(["sh", "-c", "ps -eo args | grep -x 'sleep 37' || true"], {
      timeoutInMs: COMMAND_TIMEOUT_IN_MS,
    });

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
    expect(remaining.stdout.trim()).toBe("");
  });
});

describe("stopping remote command trees", () => {
  test("kills the children of the remote process too", async () => {
    const run = createRemoteRunner(connection);

    await run(["sh", "-c", "sleep 39 & sleep 40"], { timeoutInMs: SHORT_TIMEOUT_IN_MS });
    await Bun.sleep(KILL_SETTLE_IN_MS);
    const remaining = await run(["sh", "-c", "ps -eo args | grep -xE 'sleep (39|40)' || true"], {
      timeoutInMs: COMMAND_TIMEOUT_IN_MS,
    });

    expect(remaining.stdout.trim()).toBe("");
  });

  test("kills the remote process when the caller aborts", async () => {
    const run = createRemoteRunner(connection);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ABORT_AFTER_IN_MS);

    const result = await run(["sleep", "38"], {
      timeoutInMs: COMMAND_TIMEOUT_IN_MS,
      signal: controller.signal,
    });

    expect(result.aborted).toBe(true);
    expect(result.exitCode).not.toBe(0);
  });

  test("runs many commands in parallel on one connection", async () => {
    const run = createRemoteRunner(connection);
    const parallelCommands = 8;

    const results = await Promise.all(
      Array.from(
        { length: parallelCommands },
        async (_, index) =>
          await run(["echo", String(index)], { timeoutInMs: COMMAND_TIMEOUT_IN_MS }),
      ),
    );

    expect(results.map((result) => result.stdout.trim())).toEqual(
      Array.from({ length: parallelCommands }, (_, index) => String(index)),
    );
  });
});

describe("SSH connection", () => {
  test("reaches an address only the server can see through a tunnel", async () => {
    const tunnel = await connection.forwardOut("127.0.0.1", 8080);
    const response = Promise.withResolvers<string>();
    let text = "";
    tunnel.on("data", (chunk: Buffer) => (text += chunk.toString()));
    tunnel.on("close", () => response.resolve(text));

    tunnel.end("GET /health HTTP/1.0\r\nHost: localhost\r\n\r\n");

    expect((await response.promise).split("\r\n")[0]).toBe("HTTP/1.1 200 OK");
  });

  test("records the host key fingerprint ssh-keygen reports", async () => {
    await connection.connect();
    const expected = await docker([
      "exec",
      CONTAINER,
      "ssh-keygen",
      "-l",
      "-E",
      "sha256",
      "-f",
      "/etc/ssh/ssh_host_ed25519_key.pub",
    ]);

    expect(expected).toContain(connection.hostKeyFingerprint ?? "missing");
  });

  test("throws HostKeyMismatchError when the server presents another host key", async () => {
    using pinned = new SshConnection(
      target({ hostKeyFingerprint: "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }),
    );

    const error = await pinned.connect().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HostKeyMismatchError);
  });
});
