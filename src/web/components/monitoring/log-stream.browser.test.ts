import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import { type Browser, chromium, type Route } from "playwright";

import { formatServerSentEvent } from "@/web/server/event-stream";

let browser: Browser | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;
let directory: string | undefined;
let nativeConnections = 0;
let nativeCursor = "";
const cacheDirectory = resolve("node_modules/.cache");
const viewerPath = JSON.stringify(join(import.meta.dir, "log-viewer.tsx").replaceAll("\\", "/"));
const fixture = `
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { LogViewer } from ${viewerPath};
function App() {
  const [url, setUrl] = useState(new URL(location.href).searchParams.get("source") ?? "/events/first");
  const [completed, setCompleted] = useState(0);
  const [summary, setSummary] = useState("");
  return <main>
    <button onClick={() => setUrl("/events/second")}>Trocar fonte</button>
    <LogViewer url={url} emptyMessage="Nenhum log recebido" onEnd={(value) => { setCompleted((count) => count + 1); setSummary(JSON.stringify(value)); }} />
    <output aria-label="Términos recebidos">{completed}</output>
    <output aria-label="Resumo final">{summary}</output>
  </main>;
}
createRoot(document.getElementById("root")).render(<App />);
`;

beforeAll(async () => {
  await mkdir(cacheDirectory, { recursive: true });
  directory = await mkdtemp(join(cacheDirectory, "validated-log-stream-"));
  const entry = join(directory, "fixture.tsx");
  await Bun.write(entry, fixture);
  const build = await Bun.build({ entrypoints: [entry], target: "browser" });
  const script = build.outputs.at(0);
  if (build.success === false || script == null) {
    throw new Error(
      `Log stream fixture did not build: ${build.logs.map((log) => log.message).join("\n")}`,
    );
  }
  server = Bun.serve({
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === "/native-events") {
        nativeConnections += 1;
        nativeCursor = request.headers.get("last-event-id") ?? "";
        return new Response(
          nativeConnections === 1 ? `retry: 10\n\n${FIRST_LINE}` : SECOND_LINE + END,
          {
            headers: { "Content-Type": "text/event-stream" },
          },
        );
      }
      if (new URL(request.url).pathname === "/fixture.js") {
        return new Response(script, { headers: { "Content-Type": "application/javascript" } });
      }
      return new Response(
        '<!doctype html><html lang="pt-BR"><head><title>Logs</title></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>',
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

async function openLogs(events: (route: Route) => string | Promise<string>, query = "") {
  if (browser == null || server == null) {
    throw new Error("Log stream browser fixture has not started");
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(2000);
  let errors: string[] = [];
  page.on("pageerror", (error) => {
    errors = [...errors, error.message];
  });
  await page.route("**/events/*", async (route) => {
    await route.fulfill({ contentType: "text/event-stream", body: await events(route) });
  });
  await page.goto(`${server.url.href}${query}`);
  return { page, errors: () => errors, [Symbol.asyncDispose]: async () => await context.close() };
}

function line(id: number, message: string) {
  return { id, message, stream: "stdout", createdAt: "2026-11-06T12:00:00.123456789Z" };
}

function logEvent(id: number, message: string) {
  return formatServerSentEvent("log", line(id, message), id);
}

const FIRST_LINE = logEvent(1, "Primeira linha");
const SECOND_LINE = logEvent(2, "Segunda linha");
const END = formatServerSentEvent("end", { status: "succeeded" });

test("renders validated runtime and deployment log lines and delivers one end summary", async () => {
  const warning = formatServerSentEvent(
    "log",
    { ...line(2, "Configuração revisada"), stream: "system", level: "warn" },
    2,
  );
  const error = formatServerSentEvent(
    "log",
    { ...line(3, "Processo falhou"), stream: "stderr", level: "error" },
    3,
  );
  await using session = await openLogs(() => FIRST_LINE + warning + error + END);
  const { page } = session;
  await page.getByText("Finalizado", { exact: true }).waitFor();
  expect(await page.getByRole("log").locator("[data-line-id]").count()).toBe(3);
  expect(await page.getByLabel("Términos recebidos").textContent()).toBe("1");
  expect(await page.getByLabel("Resumo final").textContent()).toBe('{"status":"succeeded"}');
  expect(session.errors()).toEqual([]);
});

test.each([
  "event: log\ndata: {\n\n",
  formatServerSentEvent("log", { ...line(2, "Invalid"), message: {} }, 2),
  formatServerSentEvent("end", { status: "building" }),
  "event: end\ndata: {\n\n",
])("keeps valid history and offers reconnect after an invalid event: %#", async (invalid) => {
  await using session = await openLogs(() => FIRST_LINE + invalid + SECOND_LINE + END);
  const { page } = session;
  await page.getByText("Desconectado", { exact: true }).waitFor();
  expect(await page.getByText("Primeira linha", { exact: true }).isVisible()).toBe(true);
  expect(await page.getByText("Segunda linha", { exact: true }).count()).toBe(0);
  expect(await page.getByLabel("Términos recebidos").textContent()).toBe("0");
  expect(await page.getByRole("button", { name: "Reconectar aos logs" }).isVisible()).toBe(true);
  expect(session.errors()).toEqual([]);
});

test("reconnects after invalid input without duplicating replayed lines", async () => {
  let connections = 0;
  await using session = await openLogs(() => {
    connections += 1;
    return connections === 1
      ? FIRST_LINE + "event: log\ndata: null\n\n"
      : FIRST_LINE + SECOND_LINE + END;
  });
  const { page } = session;
  await page.getByRole("button", { name: "Reconectar aos logs" }).click();
  await page.getByText("Finalizado", { exact: true }).waitFor();
  expect(await page.getByRole("log").locator("[data-line-id]").count()).toBe(2);
  expect(await page.getByText("Primeira linha", { exact: true }).count()).toBe(1);
  expect(await page.getByLabel("Términos recebidos").textContent()).toBe("1");
  expect(connections).toBe(2);
  expect(session.errors()).toEqual([]);
});

test("preserves native EventSource reconnection and its resume cursor", async () => {
  nativeConnections = 0;
  nativeCursor = "";
  await using session = await openLogs(() => {
    throw new Error("Native EventSource must use the real HTTP fixture");
  }, "?source=/native-events");
  await session.page.getByText("Finalizado", { exact: true }).waitFor();
  expect(await session.page.getByRole("log").locator("[data-line-id]").count()).toBe(2);
  expect(nativeConnections).toBe(2);
  expect(nativeCursor).toBe("1");
  expect(session.errors()).toEqual([]);
});

test("resets the previous stream when the source URL changes", async () => {
  await using session = await openLogs((route) =>
    route.request().url().endsWith("/first")
      ? FIRST_LINE + END
      : SECOND_LINE + formatServerSentEvent("end", {}),
  );
  const { page } = session;
  await page.getByText("Primeira linha", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Trocar fonte" }).click();
  await page.getByText("Segunda linha", { exact: true }).waitFor();
  expect(await page.getByText("Primeira linha", { exact: true }).count()).toBe(0);
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Resumo final"]')?.textContent === "{}",
  );
  expect(session.errors()).toEqual([]);
});
