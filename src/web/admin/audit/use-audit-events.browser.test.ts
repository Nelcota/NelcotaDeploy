import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import { type Browser, chromium } from "playwright";
import { z } from "zod";

import { pageCursorSchema, type PageCursor } from "@/shared/pagination";

import type { AuditEvent } from "./audit-row";

let browser: Browser | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;
let directory: string | undefined;
const cacheDirectory = resolve("node_modules/.cache");
const PAGE_SIZE = 2;
const CREATED_AT = "2026-11-06T12:00:00.000Z";
const tabPath = JSON.stringify(join(import.meta.dir, "audit-tab.tsx").replaceAll("\\", "/"));
const fixture = `
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useIsFetching } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { AuditTab } from ${tabPath};
const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
function App() {
  const fetching = useIsFetching({ queryKey: ["audit"] });
  return <main>
    <button disabled={fetching > 0} onClick={() => void client.invalidateQueries({ queryKey: ["audit"] })}>Atualizar histórico</button>
    <AuditTab /><Toaster />
  </main>;
}
createRoot(document.getElementById("root")).render(<QueryClientProvider client={client}><App /></QueryClientProvider>);
`;

beforeAll(async () => {
  await mkdir(cacheDirectory, { recursive: true });
  directory = await mkdtemp(join(cacheDirectory, "audit-query-"));
  const entry = join(directory, "fixture.tsx");
  await Bun.write(entry, fixture);
  const build = await Bun.build({
    entrypoints: [entry],
    target: "browser",
    plugins: [
      {
        name: "audit-server-function-fixture",
        setup(builder) {
          builder.onLoad({ filter: /audit\.functions\.ts$/ }, () => ({
            loader: "ts",
            contents: `export async function listAuditEventsFn({ data }) {
            const response = await fetch("/events", { method: "POST", body: JSON.stringify(data) });
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
      `Audit fixture did not build: ${build.logs.map((log) => log.message).join("\n")}`,
    );
  }
  server = Bun.serve({
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === "/fixture.js") {
        return new Response(script, { headers: { "Content-Type": "application/javascript" } });
      }
      return new Response(
        '<!doctype html><html lang="pt-BR"><head><title>Auditoria</title></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>',
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

async function openAudit(
  handler: (before: PageCursor | undefined) => Response | Promise<Response>,
) {
  if (browser == null || server == null) {
    throw new Error("Audit browser fixture has not started");
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(2000);
  await page.route("**/events", async (route) => {
    const { before } = z
      .object({ before: pageCursorSchema.optional() })
      .parse(route.request().postDataJSON());
    const response = await handler(before);
    await route.fulfill({
      status: response.status,
      body: await response.text(),
      headers: { "Content-Type": "application/json" },
    });
  });
  await page.goto(server.url.href);
  return { page, [Symbol.asyncDispose]: async () => await context.close() };
}

function event(number: number): AuditEvent {
  const id = String(number).padStart(3, "0");
  return {
    id,
    actorType: "system",
    actorLabel: `event-${id}`,
    action: "project.created",
    targetType: "project",
    targetId: null,
    details: "{}",
    createdAt: CREATED_AT,
  };
}

function eventPage(events: readonly AuditEvent[], before: PageCursor | undefined): Response {
  const previousIndex =
    before == null
      ? -1
      : events.findIndex((item) => item.id === before.id && item.createdAt === before.createdAt);
  if (before != null && previousIndex === -1) {
    throw new Error(`Unknown audit cursor: ${before.id}`);
  }
  return Response.json(events.slice(previousIndex + 1, previousIndex + 1 + PAGE_SIZE));
}

test("shows initial loading, then an empty audit without a load-more action", async () => {
  const response = Promise.withResolvers<Response>();
  await using session = await openAudit(() => response.promise);
  await session.page.getByLabel("Carregando", { exact: true }).waitFor({ state: "attached" });
  expect(
    await session.page.getByRole("button", { name: "Carregar ações anteriores" }).count(),
  ).toBe(0);
  response.resolve(Response.json([]));
  await session.page.getByText("Nenhum evento registrado").waitFor();
});

test("uses both cursor fields, appends pages once and stops at an empty page", async () => {
  const events = [event(4), event(3), event(2), event(1)];
  let cursors: (PageCursor | undefined)[] = [];
  const pending = Promise.withResolvers<void>();
  await using session = await openAudit(async (before) => {
    cursors = [...cursors, before];
    if (cursors.length === 2) await pending.promise;
    return eventPage(events, before);
  });
  const { page } = session;
  await page.getByText("event-003", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Carregar ações anteriores" }).evaluate((button) => {
    if (button instanceof HTMLButtonElement === false) {
      throw new Error("Expected a load-more button");
    }
    button.click();
    button.click();
  });
  await page.getByRole("button", { name: "Carregando…", exact: true }).waitFor();
  expect(await page.getByRole("button", { name: "Carregando…", exact: true }).isDisabled()).toBe(
    true,
  );
  expect(cursors).toEqual([undefined, { id: "003", createdAt: CREATED_AT }]);
  pending.resolve();
  await page.getByText("event-001", { exact: true }).waitFor();
  expect(await page.getByText(/^event-\d+$/).allTextContents()).toEqual([
    "event-004",
    "event-003",
    "event-002",
    "event-001",
  ]);
  await page.getByRole("button", { name: "Carregar ações anteriores" }).click();
  await page.getByText("Não há eventos mais antigos.").waitFor();
  expect(cursors.at(-1)).toEqual({ id: "001", createdAt: CREATED_AT });
  expect(cursors).toHaveLength(3);
});

test("recalculates all loaded page cursors after new events arrive", async () => {
  let events = [event(4), event(3), event(2), event(1)];
  let cursors: (PageCursor | undefined)[] = [];
  const refresh = Promise.withResolvers<void>();
  await using session = await openAudit(async (before) => {
    cursors = [...cursors, before];
    if (cursors.length === 3) await refresh.promise;
    return eventPage(events, before);
  });
  const { page } = session;
  await page.getByText("event-003", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Carregar ações anteriores" }).click();
  await page.getByText("event-001", { exact: true }).waitFor();
  events = [event(6), event(5), ...events];
  await page.getByRole("button", { name: "Atualizar histórico", exact: true }).click();
  await page.getByRole("button", { name: "Carregando…", exact: true }).waitFor();
  expect(await page.getByRole("button", { name: "Carregando…", exact: true }).isDisabled()).toBe(
    true,
  );
  refresh.resolve();
  await page.getByText("event-006", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Carregar ações anteriores" }).waitFor();
  expect(await page.getByText(/^event-\d+$/).allTextContents()).toEqual([
    "event-006",
    "event-005",
    "event-004",
    "event-003",
  ]);
  expect(cursors).toEqual([
    undefined,
    { id: "003", createdAt: CREATED_AT },
    undefined,
    { id: "005", createdAt: CREATED_AT },
  ]);
  await page.getByRole("button", { name: "Carregar ações anteriores" }).click();
  await page.getByText("event-001", { exact: true }).waitFor();
  expect(await page.getByText(/^event-\d+$/).allTextContents()).toEqual([
    "event-006",
    "event-005",
    "event-004",
    "event-003",
    "event-002",
    "event-001",
  ]);
});

test("keeps loaded events and retries the same cursor after a next-page failure", async () => {
  const events = [event(4), event(3), event(2), event(1)];
  let calls = 0;
  await using session = await openAudit((before) => {
    calls += 1;
    if (calls === 2)
      return new Response("Não foi possível carregar mais eventos.", { status: 503 });
    return eventPage(events, before);
  });
  const { page } = session;
  await page.getByText("event-003", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Carregar ações anteriores" }).click();
  await page.getByText("Não foi possível carregar mais eventos.", { exact: true }).waitFor();
  expect(await page.getByRole("alert").count()).toBe(0);
  expect(await page.getByText(/^event-\d+$/).allTextContents()).toEqual(["event-004", "event-003"]);
  await page.getByRole("button", { name: "Carregar ações anteriores" }).click();
  await page.getByText("event-001", { exact: true }).waitFor();
  expect(calls).toBe(3);
});

test("retries an initial failure through the existing error state", async () => {
  let calls = 0;
  await using session = await openAudit(() => {
    calls += 1;
    return calls === 1
      ? new Response("Não foi possível carregar os dados.", { status: 503 })
      : Response.json([]);
  });
  await session.page.getByRole("alert").waitFor();
  await session.page.getByRole("button", { name: "Atualizar dados novamente" }).click();
  await session.page.getByText("Nenhum evento registrado").waitFor();
  expect(calls).toBe(2);
});
