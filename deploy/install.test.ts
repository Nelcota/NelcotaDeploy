import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "node:process";

import { checkReleaseUpdate } from "./installer-update.fixture";

const INSTALL_DIR = "/opt/nelcota-deploy";
const DOMAIN = "installer.example.test";
const EMAIL = "admin@example.com";
const INSTALL_TIMEOUT_MS = 10 * 60 * 1_000;
const PRIVATE_FILE_MODE = 0o600;
const PERMISSION_BITS = 0o777;

async function runInstaller(
  bin: string,
  args: string[],
  { previousIngressStart = "", script = "install.sh" } = {},
) {
  const child = Bun.spawn(["bash", script, ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...env,
      PATH: `${bin}:${env["PATH"] ?? "/usr/bin:/bin"}`,
      INSTALL_TEST_PREVIOUS_INGRESS_START: previousIngressStart,
    },
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

async function stubPublicNetwork(bin: string) {
  await writeFile(join(bin, "getent"), '#!/bin/sh\nprintf "127.0.0.1 STREAM %s\\n" "$2"\n', {
    mode: 0o700,
  });
  // Simulate an invalid certificate until Traefik restarts, then use real traffic through it.
  await writeFile(
    join(bin, "curl"),
    `#!/bin/sh
if test "$INSTALL_TEST_PREVIOUS_INGRESS_START" = fail ||
  test "$INSTALL_TEST_PREVIOUS_INGRESS_START" = "$(docker inspect -f '{{.State.StartedAt}}' nelcota-ingress)"; then
  exit 60
fi

case " $* " in
  *' --resolve '*) ;;
  *)
    if test -f "$0.public-error"; then
      exit 22
    fi

    if test -f "$0.public-timeout"; then
      case " $* " in
        *' --ipv4 '*) rm -- "$0.public-timeout" ;;
        *)
          printf '{"status":'
          exit 28
          ;;
      esac
    fi
    ;;
esac

exec /usr/bin/curl --insecure --resolve '${DOMAIN}:443:127.0.0.1' "$@"
`,
    { mode: 0o700 },
  );
}

async function ingressStartedAt(): Promise<string> {
  const inspect = Bun.spawn(
    ["docker", "inspect", "-f", "{{.State.StartedAt}}", "nelcota-ingress"],
    {
      stdout: "pipe",
    },
  );
  const startedAt = (await new Response(inspect.stdout).text()).trim();
  expect(await inspect.exited).toBe(0);
  return startedAt;
}

async function checkVolumeOwnership(
  bin: string,
  environmentPath: string,
  savedEnvironment: string,
) {
  const foreignEnvironment = savedEnvironment.replace(
    /^NELCOTA_INSTALL_ID=[a-f0-9]{32}$/m,
    (line) => (line.endsWith("0") ? `${line.slice(0, -1)}1` : `${line.slice(0, -1)}0`),
  );
  expect(foreignEnvironment === savedEnvironment).toBe(false);
  await writeFile(environmentPath, foreignEnvironment);
  try {
    const result = await runInstaller(bin, []);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Docker volume nelcota_data belongs to another installation");
  } finally {
    await writeFile(environmentPath, savedEnvironment);
  }
}

async function checkLogin(password: string) {
  const login = Bun.spawn(
    [
      "/usr/bin/curl",
      "--silent",
      "--insecure",
      "--retry",
      "5",
      "--retry-all-errors",
      "--retry-delay",
      "1",
      "--resolve",
      `${DOMAIN}:443:127.0.0.1`,
      "--noproxy",
      "*",
      "--output",
      "/dev/null",
      "--write-out",
      "%{http_code}",
      "--json",
      "@-",
      "--header",
      `Origin: https://${DOMAIN}`,
      `https://${DOMAIN}/api/auth/sign-in/email`,
    ],
    {
      stdin: new Response(JSON.stringify({ email: EMAIL, password: password.trim() })),
      stdout: "pipe",
    },
  );
  expect(await new Response(login.stdout).text()).toBe("200");
  expect(await login.exited).toBe(0);
}

test(
  "restarts Traefik to recover from an invalid certificate and preserves the first administrator",
  async () => {
    const environmentPath = join(INSTALL_DIR, ".env");
    const passwordPath = join(INSTALL_DIR, "initial-admin-password");
    expect(await Bun.file(environmentPath).exists()).toBe(false);
    const bin = await mkdtemp(join(tmpdir(), "nelcota-installer-test-"));
    try {
      await stubPublicNetwork(bin);

      const initial = await runInstaller(bin, ["--domain", DOMAIN, "--email", EMAIL], {
        previousIngressStart: "fail",
      });
      expect(initial.exitCode, initial.stderr).toBe(1);
      expect(initial.stderr).toContain("HTTPS is not ready");
      expect((await stat(environmentPath)).mode & PERMISSION_BITS).toBe(PRIVATE_FILE_MODE);
      expect((await stat(passwordPath)).mode & PERMISSION_BITS).toBe(PRIVATE_FILE_MODE);
      const savedEnvironment = await readFile(environmentPath, "utf8");
      const savedPassword = await readFile(passwordPath, "utf8");
      const initialIngressStart = await ingressStartedAt();
      await writeFile(join(bin, "curl.public-timeout"), "");

      const retry = await runInstaller(bin, [], { previousIngressStart: initialIngressStart });
      expect(retry.exitCode, retry.stderr).toBe(0);
      expect(retry.stdout).toContain("Public HTTPS check timed out. Retrying over IPv4");
      expect(retry.stdout).toContain(`Panel ready at https://${DOMAIN}`);
      expect((await readFile(environmentPath, "utf8")) === savedEnvironment).toBe(true);
      expect((await readFile(passwordPath, "utf8")) === savedPassword).toBe(true);
      const restartedIngress = await ingressStartedAt();
      expect(restartedIngress).not.toBe(initialIngressStart);

      await checkLogin(savedPassword);
      await rm(passwordPath);
      const afterLogin = await runInstaller(bin, []);
      expect(afterLogin.exitCode, afterLogin.stderr).toBe(0);
      expect(await Bun.file(passwordPath).exists()).toBe(false);
      expect(await ingressStartedAt()).toBe(restartedIngress);

      await checkVolumeOwnership(bin, environmentPath, savedEnvironment);
      await checkReleaseUpdate({
        bin,
        installDirectory: INSTALL_DIR,
        savedEnvironment,
        runUpdate: async (script) => await runInstaller(bin, ["--update"], { script }),
        checkLogin: () => checkLogin(savedPassword),
      });
    } finally {
      await rm(bin, { recursive: true, force: true });
    }
  },
  INSTALL_TIMEOUT_MS,
);
