import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import { type Browser, chromium, type Page } from "playwright";
import { z } from "zod";

import {
  environmentImportSchema,
  type EnvironmentImportInput,
} from "@/shared/schemas/environment-import.schema";

let browser: Browser | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;
let directory: string | undefined;
const cacheDirectory = resolve("node_modules/.cache");
const dialogPath = JSON.stringify(
  join(import.meta.dir, "env-import-dialog.tsx").replaceAll("\\", "/"),
);
const PROJECT_ID = "project-one";
const fixture = `
import { createRoot } from "react-dom/client";
import { useState, useSyncExternalStore } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { EnvImportDialog } from ${dialogPath};
const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
const cache = client.getMutationCache();
const subscribe = (notify) => cache.subscribe(notify);
const snapshot = () => cache.getAll().length;
async function version(name) { return await (await fetch("/cache/" + name)).json(); }
function App() {
  const [imported, setImported] = useState(0);
  const environment = useQuery({ queryKey: ["environment", "${PROJECT_ID}"], queryFn: () => version("environment"), initialData: 0 });
  const project = useQuery({ queryKey: ["project", "${PROJECT_ID}"], queryFn: () => version("project"), initialData: 0 });
  useQuery({ queryKey: ["environment", "other-project"], queryFn: () => version("other"), initialData: 0 });
  const mutations = useSyncExternalStore(subscribe, snapshot);
  return <main>
    <EnvImportDialog projectId="${PROJECT_ID}" variables={[]} onImported={() => setImported((count) => count + 1)} />
    <output aria-label="Importações concluídas">{imported}</output>
    <output aria-label="Cache de variáveis">{environment.data}</output>
    <output aria-label="Cache do projeto">{project.data}</output>
    <output aria-label="Mutações retidas">{mutations}</output>
    <Toaster />
  </main>;
}
createRoot(document.getElementById("root")).render(<QueryClientProvider client={client}><App /></QueryClientProvider>);
`;

beforeAll(async () => {
  await mkdir(cacheDirectory, { recursive: true });
  directory = await mkdtemp(join(cacheDirectory, "env-import-query-"));
  const entry = join(directory, "fixture.tsx");
  await Bun.write(entry, fixture);
  const build = await Bun.build({
    entrypoints: [entry],
    target: "browser",
    plugins: [
      {
        name: "environment-server-function-fixture",
        setup(builder) {
          builder.onLoad({ filter: /environment\.functions\.ts$/ }, () => ({
            loader: "ts",
            contents: `export async function importEnvironmentVariablesFn({ data }) {
            const response = await fetch("/import", { method: "POST", body: JSON.stringify(data) });
            if (response.ok === false) throw new Error(await response.text());
            return await response.json();
          }`,
          }));
        },
      },
    ],
  });
  const script = build.outputs.at(0);
  if (build.success === false || script == null) {
    throw new Error(
      `Environment import fixture did not build: ${build.logs.map((log) => log.message).join("\n")}`,
    );
  }
  server = Bun.serve({
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === "/fixture.js") {
        return new Response(script, { headers: { "Content-Type": "application/javascript" } });
      }
      return new Response(
        '<!doctype html><html lang="pt-BR"><head><title>Importação</title></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>',
        {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        },
      );
    },
  });
  browser = await chromium.launch({ channel: "chromium" });
}, 30_000);

afterAll(async () => {
  await browser?.close();
  await server?.stop(true);
  if (directory?.startsWith(`${cacheDirectory}${sep}`) === true) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function openImport(options: {
  readonly importResponse: (input: EnvironmentImportInput) => Response | Promise<Response>;
  readonly cacheResponse?: (name: string) => Response | Promise<Response>;
}) {
  if (browser == null || server == null) {
    throw new Error("Environment import browser fixture has not started");
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(2000);
  const cacheCalls = new Map<string, number>();
  await page.route("**/import", async (route) => {
    const { projectId, input } = z
      .object({ projectId: z.literal(PROJECT_ID), input: environmentImportSchema })
      .parse(route.request().postDataJSON());
    expect(projectId).toBe(PROJECT_ID);
    const response = await options.importResponse(input);
    await route.fulfill({
      status: response.status,
      body: await response.text(),
      headers: { "Content-Type": "application/json" },
    });
  });
  await page.route("**/cache/*", async (route) => {
    const name = new URL(route.request().url()).pathname.split("/").at(-1);
    if (name == null || name === "") throw new Error("Missing query cache fixture name");
    cacheCalls.set(name, (cacheCalls.get(name) ?? 0) + 1);
    const response = await (options.cacheResponse?.(name) ?? Response.json(cacheCalls.get(name)));
    await route.fulfill({
      status: response.status,
      body: await response.text(),
      headers: { "Content-Type": "application/json" },
    });
  });
  await page.goto(server.url.href);
  await page.getByRole("button", { name: "Selecionar ou colar arquivo .env" }).click();
  return { page, cacheCalls, [Symbol.asyncDispose]: async () => await context.close() };
}

async function review(page: Page, text: string) {
  await page.getByLabel("Conteúdo", { exact: true }).fill(text);
  await page.getByRole("button", { name: "Revisar alterações das variáveis" }).click();
  await page.getByRole("list", { name: "Revisão das variáveis a importar" }).waitFor();
}

test.each([1, 2])(
  "imports %d reviewed entries, refreshes the project caches and clears mutation secrets",
  async (count) => {
    let submitted: EnvironmentImportInput | undefined;
    await using session = await openImport({
      importResponse(input) {
        submitted = input;
        return Response.json({ savedCount: input.entries.length });
      },
    });
    const text =
      count === 1 ? "API_TOKEN=private-value" : "API_TOKEN=private-value\nNODE_ENV=production";
    await review(session.page, text);
    await session.page.getByRole("button", { name: /^Importar/ }).click();
    await session.page.getByRole("dialog").waitFor({ state: "hidden" });
    await session.page
      .getByText(count === 1 ? "1 variável importada" : "2 variáveis importadas", { exact: true })
      .waitFor();
    expect(submitted?.entries.map(({ key, value }) => ({ key, value }))).toEqual(
      count === 1
        ? [{ key: "API_TOKEN", value: "private-value" }]
        : [
            { key: "API_TOKEN", value: "private-value" },
            { key: "NODE_ENV", value: "production" },
          ],
    );
    expect(await session.page.getByLabel("Importações concluídas").textContent()).toBe("1");
    expect(await session.page.getByLabel("Cache de variáveis").textContent()).toBe("1");
    expect(await session.page.getByLabel("Cache do projeto").textContent()).toBe("1");
    expect(session.cacheCalls).toEqual(
      new Map([
        ["environment", 1],
        ["project", 1],
      ]),
    );
    await session.page.waitForFunction(
      () => document.querySelector('[aria-label="Mutações retidas"]')?.textContent === "0",
    );
    await session.page.getByRole("button", { name: "Selecionar ou colar arquivo .env" }).click();
    expect(await session.page.getByLabel("Conteúdo", { exact: true }).inputValue()).toBe("");
  },
);

test("stays pending through both invalidations and prevents closing or repeated imports", async () => {
  const imported = Promise.withResolvers<Response>();
  const environment = Promise.withResolvers<Response>();
  const project = Promise.withResolvers<Response>();
  let calls = 0;
  await using session = await openImport({
    importResponse() {
      calls += 1;
      return imported.promise;
    },
    cacheResponse: (name) => (name === "environment" ? environment.promise : project.promise),
  });
  const { page } = session;
  await review(page, "NODE_ENV=production");
  const confirm = page.getByRole("button", { name: /^Importar/ });
  await confirm.click();
  await page
    .locator("button:disabled")
    .filter({ hasText: /^Importar/ })
    .waitFor();
  expect(await confirm.isDisabled()).toBe(true);
  expect(
    await page.getByRole("button", { name: "Voltar para editar importação" }).isDisabled(),
  ).toBe(true);
  await page.keyboard.press("Escape");
  expect(await page.getByRole("dialog").isVisible()).toBe(true);
  imported.resolve(Response.json({ savedCount: 1 }));
  await page.getByText("1 variável importada", { exact: true }).waitFor();
  expect(await confirm.isDisabled()).toBe(true);
  environment.resolve(Response.json(1));
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Cache de variáveis"]')?.textContent === "1",
  );
  expect(await confirm.isDisabled()).toBe(true);
  project.resolve(Response.json(1));
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  expect(calls).toBe(1);
});

test("retains pasted values on failure, refreshes both caches and allows a reviewed retry", async () => {
  let calls = 0;
  await using session = await openImport({
    importResponse() {
      calls += 1;
      return calls === 1
        ? new Response("As variáveis foram alteradas. Revise novamente.", { status: 409 })
        : Response.json({ savedCount: 1 });
    },
  });
  const { page } = session;
  const text = "API_TOKEN=retained-private-value";
  await review(page, text);
  await page.getByRole("button", { name: /^Importar/ }).click();
  await page
    .getByText("As variáveis foram alteradas. Revise novamente.", { exact: true })
    .waitFor();
  await page.getByLabel("Conteúdo", { exact: true }).waitFor();
  expect(await page.getByLabel("Conteúdo", { exact: true }).inputValue()).toBe(text);
  expect(session.cacheCalls).toEqual(
    new Map([
      ["environment", 1],
      ["project", 1],
    ]),
  );
  expect(await page.getByLabel("Importações concluídas").textContent()).toBe("0");
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Mutações retidas"]')?.textContent === "0",
  );
  await page.getByRole("button", { name: "Revisar alterações das variáveis" }).click();
  await page.getByRole("button", { name: /^Importar/ }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  expect(session.cacheCalls).toEqual(
    new Map([
      ["environment", 2],
      ["project", 2],
    ]),
  );
  expect(calls).toBe(2);
});

test("reports a network failure without retaining the mutation or losing the pasted input", async () => {
  await using session = await openImport({
    importResponse: () => Response.json({ savedCount: 1 }),
  });
  await session.page.route("**/import", async (route) => await route.abort("failed"));
  await review(session.page, "NODE_ENV=production");
  await session.page.getByRole("button", { name: /^Importar/ }).click();
  await session.page
    .getByText("Sem conexão com o servidor. Verifique a rede e tente novamente.", { exact: true })
    .waitFor();
  await session.page.getByLabel("Conteúdo", { exact: true }).waitFor();
  expect(await session.page.getByLabel("Conteúdo", { exact: true }).inputValue()).toBe(
    "NODE_ENV=production",
  );
  await session.page.waitForFunction(
    () => document.querySelector('[aria-label="Mutações retidas"]')?.textContent === "0",
  );
});
