// Visual and accessibility review of every screen, on a throwaway copy of the panel.
// Usage: bun run ui:review  (screenshots and report land in ui-review-output/)
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { AxeBuilder } from "@axe-core/playwright";
import { type Browser, chromium, type Page } from "playwright";

import { mapInSequence } from "./sequence";

const PORT = Number(process.env["UI_REVIEW_PORT"] ?? "3199");
const BASE_URL = `http://localhost:${PORT}`;
const OUTPUT_DIRECTORY = resolve("ui-review-output");
const SERVER_START_TIMEOUT_IN_MS = 120_000;
const POLL_INTERVAL_IN_MS = 500;
const REQUEST_TIMEOUT_IN_MS = 2000;
const SETTLE_DELAY_IN_MS = 1500;
const SECRET_BYTES = 32;
const VIEWPORTS = [
  { name: "mobile", width: 375, height: 812 },
  { name: "desktop", width: 1440, height: 900 },
] as const;
const THEMES = ["light", "dark"] as const;
const BLOCKING_IMPACTS = new Set(["serious", "critical"]);
const MAX_SEED_OUTPUT_IN_ERROR = 200;

type Theme = (typeof THEMES)[number];
type Finding = {
  readonly page: string;
  readonly theme: Theme;
  readonly rule: string;
  readonly impact: string;
  readonly help: string;
  readonly targets: readonly string[];
};

function randomSecret(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(SECRET_BYTES))).toString("base64");
}

function pagesFor(
  projectId: string,
  deploymentId: string,
  resources: { readonly taskId: string; readonly databaseId: string },
): PageEntry[] {
  const project = `/projects/${projectId}`;
  return [
    { name: "login", path: "/login", signedIn: false },
    { name: "painel", path: "/", signedIn: true },
    { name: "deployment-activity", path: "/activity", signedIn: true },
    { name: "deployment-statistics", path: "/deployment-statistics", signedIn: true },
    { name: "server-metrics", path: "/server-metrics", signedIn: true },
    { name: "projetos", path: "/projects", signedIn: true },
    { name: "novo-projeto", path: "/projects/new", signedIn: true },
    { name: "deploys", path: "/deployments", signedIn: true },
    { name: "projeto-visao-geral", path: project, signedIn: true },
    { name: "projeto-deploys", path: `${project}/deployments`, signedIn: true },
    { name: "projeto-deploy", path: `${project}/deployments/${deploymentId}`, signedIn: true },
    { name: "build-logs", path: `${project}/deployments/${deploymentId}/logs`, signedIn: true },
    { name: "project-previews", path: `${project}/previews`, signedIn: true },
    { name: "projeto-logs", path: `${project}/logs`, signedIn: true },
    { name: "projeto-metricas", path: `${project}/metrics`, signedIn: true },
    { name: "projeto-variaveis", path: `${project}/environment`, signedIn: true },
    { name: "environment-import", path: `${project}/environment/import`, signedIn: true },
    { name: "environment-repository", path: `${project}/environment/repository`, signedIn: true },
    { name: "projeto-dominios", path: `${project}/domains`, signedIn: true },
    { name: "project-dns", path: `${project}/dns`, signedIn: true },
    { name: "projeto-bancos", path: `${project}/databases`, signedIn: true },
    {
      name: "database-backups",
      path: `${project}/databases/${resources.databaseId}/backups`,
      signedIn: true,
    },
    {
      name: "database-restore",
      path: `${project}/databases/${resources.databaseId}/restore`,
      signedIn: true,
    },
    { name: "projeto-tasks", path: `${project}/tasks`, signedIn: true },
    { name: "task-history", path: `${project}/tasks/${resources.taskId}/history`, signedIn: true },
    ...[
      "identity",
      "repository",
      "build",
      "runtime",
      "automation",
      "volumes",
      "server",
      "deletion",
    ].map((section) => ({
      name: `project-settings-${section}`,
      path: `${project}/settings/${section}`,
      signedIn: true,
    })),
    { name: "admin-organizacao", path: "/settings/organization", signedIn: true },
    { name: "admin-domains", path: "/settings/domains", signedIn: true },
    { name: "admin-alerts", path: "/settings/alerts", signedIn: true },
    { name: "admin-usuarios", path: "/settings/users", signedIn: true },
    { name: "admin-servidores", path: "/settings/servers", signedIn: true },
    { name: "admin-sistema", path: "/settings/system", signedIn: true },
    { name: "admin-github", path: "/settings/integrations/github", signedIn: true },
    { name: "admin-cloudflare", path: "/settings/integrations/cloudflare", signedIn: true },
    { name: "admin-tokens", path: "/settings/tokens", signedIn: true },
    { name: "admin-auditoria", path: "/settings/audit", signedIn: true },
    { name: "webhook-deliveries", path: "/settings/webhooks", signedIn: true },
    ...dialogsFor(project),
  ];
}

/** Modals, opened by clicking the button named in `opens` on their page. */
function dialogsFor(project: string) {
  return [
    ["modal-adicionar-servidor", "/settings/servers", "Adicionar servidor"],
    ["modal-remover-servidor", "/settings/servers", "Remover"],
    ["modal-novo-token", "/settings/tokens", "Novo token"],
    ["modal-novo-usuario", "/settings/users", "Novo usuário"],
    ["modal-nova-variavel", `${project}/environment`, "Nova variável"],
    ["modal-importar-env", `${project}/environment/import`, "Importar .env"],
    ["modal-nova-task", `${project}/tasks`, "Nova task"],
    ["modal-busca", "/", "Buscar projetos e páginas"],
  ].map(([name = "", path = "", opens = ""]) => ({ name, path, signedIn: true, opens }));
}

async function seed(environment: Record<string, string>) {
  const child = Bun.spawn(["bun", "run", "src/ui-review/seed.ts"], {
    env: environment,
    stdout: "pipe",
    stderr: "inherit",
  });
  const output = await new Response(child.stdout).text();
  if ((await child.exited) !== 0) {
    throw new Error("seeding the review database failed");
  }
  const lastLine = output.trim().split("\n").at(-1) ?? "";
  const parsed: unknown = JSON.parse(lastLine);
  if (
    typeof parsed !== "object" ||
    parsed == null ||
    "projectId" in parsed === false ||
    "deploymentId" in parsed === false ||
    typeof parsed.projectId !== "string" ||
    typeof parsed.deploymentId !== "string" ||
    "taskId" in parsed === false ||
    typeof parsed.taskId !== "string" ||
    "databaseId" in parsed === false ||
    typeof parsed.databaseId !== "string"
  ) {
    throw new Error(`unexpected seed output: ${lastLine.slice(0, MAX_SEED_OUTPUT_IN_ERROR)}`);
  }
  return {
    projectId: parsed.projectId,
    deploymentId: parsed.deploymentId,
    taskId: parsed.taskId,
    databaseId: parsed.databaseId,
  };
}

// Each attempt depends on the server having started since the last one, so attempts never overlap.
async function waitForServer(deadline = Date.now() + SERVER_START_TIMEOUT_IN_MS): Promise<void> {
  if (Date.now() >= deadline) {
    throw new Error(`the review server did not answer on ${BASE_URL} in time`);
  }
  const response = await fetch(`${BASE_URL}/api/health`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_IN_MS),
  }).catch(() => null);
  if (response?.ok === true) {
    return;
  }
  await Bun.sleep(POLL_INTERVAL_IN_MS);
  await waitForServer(deadline);
}

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto(`${BASE_URL}/login`);
  // Typing before React hydrates the form leaves its state empty, so wait for the page to settle.
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Seu e-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  try {
    await page.waitForURL(`${BASE_URL}/`);
  } catch (error) {
    await page.screenshot({ path: join(OUTPUT_DIRECTORY, "login-failed.png") });
    const shown = await page
      .getByRole("alert")
      .textContent()
      .catch(() => null);
    throw new Error(`sign-in failed; the page showed: ${shown ?? "no message"}`, { cause: error });
  }
}

type PageEntry = {
  readonly name: string;
  readonly path: string;
  readonly signedIn: boolean;
  readonly opens?: string;
};

async function capture(page: Page, directory: string, entry: PageEntry): Promise<void> {
  await page.goto(`${BASE_URL}${entry.path}`);
  await page.waitForTimeout(SETTLE_DELAY_IN_MS);
  const opens = entry.opens ?? null;
  if (opens != null) {
    await page.getByRole("button", { name: opens, exact: true }).first().click();
    await page.getByRole("dialog").or(page.getByRole("alertdialog")).first().waitFor();
    await page.waitForTimeout(SETTLE_DELAY_IN_MS);
  }
  // A modal sits over the viewport, so it is shot as the user sees it.
  await page.screenshot({ path: join(directory, `${entry.name}.png`), fullPage: opens == null });
}

async function accessibilityFindings(page: Page, entry: PageEntry, theme: Theme) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  return result.violations.map((violation): Finding => ({
    page: entry.name,
    theme,
    rule: violation.id,
    impact: violation.impact ?? "unknown",
    help: violation.help,
    targets: violation.nodes.map((node) => {
      const reason = node.any[0]?.message ?? node.failureSummary ?? "";
      return `${node.target.join(" ")} — ${reason}`;
    }),
  }));
}

async function newReviewPage(browser: Browser, theme: Theme, viewport: (typeof VIEWPORTS)[number]) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    colorScheme: theme,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
  });
  await context.addInitScript((value) => {
    localStorage.setItem("nelcota-theme", value);
  }, theme);
  // The app shell scrolls inside <main>; let the document grow so full-page shots see it all.
  await context.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent =
        ".h-svh, .h-svh > div, #main { height: auto !important; overflow: visible !important; }";
      document.head.append(style);
    });
  });
  return { context, page: await context.newPage() };
}

/** What stays the same across every theme and viewport of one review. */
type ReviewRun = {
  readonly browser: Browser;
  readonly pages: readonly PageEntry[];
  readonly credentials: { readonly email: string; readonly password: string };
};

async function reviewViewport(
  { browser, pages, credentials }: ReviewRun,
  theme: Theme,
  viewport: (typeof VIEWPORTS)[number],
): Promise<Finding[]> {
  const { context, page } = await newReviewPage(browser, theme, viewport);
  await using _context = { [Symbol.asyncDispose]: async () => await context.close() };
  const directory = join(OUTPUT_DIRECTORY, `${theme}-${viewport.name}`);
  await mkdir(directory, { recursive: true });
  // Pages are visited one by one: they share the signed-in browser tab.
  await mapInSequence(
    pages.filter((item) => item.signedIn === false),
    async (entry) => await capture(page, directory, entry),
  );
  await signIn(page, credentials.email, credentials.password);
  const findings = await mapInSequence(
    pages.filter((item) => item.signedIn),
    async (entry) => {
      await capture(page, directory, entry);
      if (viewport.name !== "desktop") {
        return [];
      }
      return await accessibilityFindings(page, entry, theme);
    },
  );
  return findings.flat();
}

async function reviewTheme(run: ReviewRun, theme: Theme): Promise<Finding[]> {
  const findings = await mapInSequence(
    VIEWPORTS,
    async (viewport) => await reviewViewport(run, theme, viewport),
  );
  return findings.flat();
}

function reportOf(findings: readonly Finding[]): string {
  if (findings.length === 0) {
    return "# Revisão de interface\n\nNenhum problema de acessibilidade encontrado.\n";
  }
  const lines = ["# Revisão de interface", "", `${findings.length} problemas encontrados.`, ""];
  for (const finding of findings) {
    lines.push(
      `- **${finding.impact}** · ${finding.page} (${finding.theme}) · \`${finding.rule}\`: ${finding.help}`,
    );
    for (const target of finding.targets) {
      lines.push(`  - ${target}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

const workDirectory = await mkdtemp(join(tmpdir(), "nelcota-ui-review-"));
await using _workDirectory = {
  [Symbol.asyncDispose]: async () => await rm(workDirectory, { recursive: true, force: true }),
};
const credentials = { email: "revisao@exemplo.com", password: randomSecret() };
const environment: Record<string, string> = {
  ...(process.env as Record<string, string>),
  NODE_ENV: "development",
  LOG_LEVEL: "warn",
  PORT: String(PORT),
  PUBLIC_URL: BASE_URL,
  DATABASE_PATH: join(workDirectory, "panel.db"),
  WORKSPACE_DIR: join(workDirectory, "workspaces"),
  BETTER_AUTH_SECRET: randomSecret(),
  NELCOTA_ENCRYPTION_KEY: randomSecret(),
  UI_REVIEW_EMAIL: credentials.email,
  UI_REVIEW_PASSWORD: credentials.password,
};

const ids = await seed(environment);
const server = Bun.spawn(["bun", "--bun", "vite", "dev", "--port", String(PORT), "--strictPort"], {
  env: environment,
  stdout: "ignore",
  stderr: "inherit",
});
await using _server = {
  [Symbol.asyncDispose]: async () => {
    server.kill();
    await server.exited;
  },
};
await waitForServer();

const browser = await chromium.launch();
await using _browser = { [Symbol.asyncDispose]: async () => await browser.close() };
await rm(OUTPUT_DIRECTORY, { recursive: true, force: true });
const pages = pagesFor(ids.projectId, ids.deploymentId, ids);
const run: ReviewRun = { browser, pages, credentials };
// One theme at a time keeps the dev server from compiling the same pages twice at once.
const findingsByTheme = await mapInSequence(THEMES, async (theme) => await reviewTheme(run, theme));
const findings = findingsByTheme.flat();
await writeFile(join(OUTPUT_DIRECTORY, "report.md"), reportOf(findings));

const blocking = findings.filter((finding) => BLOCKING_IMPACTS.has(finding.impact));
process.stdout.write(
  `Screenshots and report in ${OUTPUT_DIRECTORY}: ${findings.length} accessibility findings, ${blocking.length} serious or critical.\n`,
);
process.exitCode = blocking.length > 0 ? 1 : 0;
