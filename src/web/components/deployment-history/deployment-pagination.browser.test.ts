import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import { type Browser, chromium } from "playwright";
import { z } from "zod";

import { pageCursorSchema } from "@/shared/pagination";

let browser: Browser | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;
let directory: string | undefined;
const cacheDirectory = resolve("node_modules/.cache");
const hookPath = JSON.stringify(
  join(import.meta.dir, "use-deployment-history.ts").replaceAll("\\", "/"),
);
const controlsPath = JSON.stringify(
  join(import.meta.dir, "deployment-history-list.tsx").replaceAll("\\", "/"),
);
const fixture = `
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useDeploymentHistory } from ${hookPath};
import { LoadMoreButton } from ${controlsPath};
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
Reflect.set(window, "historyClient", client);
client.getQueryCache().subscribe(() => { document.body.dataset.cacheEntries = String(client.getQueryCache().getAll().length); });
function App() {
  const [status, setStatus] = useState(undefined);
  const history = useDeploymentHistory({ queryKey: ["deployments", status ?? "all"], filters: { status } });
  return <main>
    <button onClick={() => setStatus("failed")}>Falhas</button>
    <button onClick={() => void history.deployments.refetch()}>Atualizar</button>
    <output aria-label="Estado">{history.deployments.isFetching ? "Carregando" : "Pronto"}</output>
    <ul>{history.rows.map(row => <li key={row.id} data-id={row.id}>{row.id}</li>)}</ul>
    <LoadMoreButton deployments={history.deployments} />
  </main>;
}
createRoot(document.getElementById("root")).render(<QueryClientProvider client={client}><App /></QueryClientProvider>);
`;

beforeAll(async () => {
  await mkdir(cacheDirectory, { recursive: true });
  directory = await mkdtemp(join(cacheDirectory, "deployment-pagination-"));
  const entry = join(directory, "fixture.tsx");
  await Bun.write(entry, fixture);
  const build = await Bun.build({
    entrypoints: [entry],
    target: "browser",
    plugins: [
      {
        name: "deployment-functions",
        setup(builder) {
          builder.onLoad({ filter: /deployments\.functions\.ts$/ }, () => ({
            loader: "ts",
            contents: `
        export async function listDeploymentsFn({data}) {
          const response = await fetch("/deployments", {method:"POST",body:JSON.stringify(data)});
          if(response.ok === false) throw new Error("History request failed");
          return await response.json();
        }
      `,
          }));
        },
      },
    ],
  });
  const script = build.outputs.at(0);
  if (build.success === false || script == null) {
    throw new Error(
      `Deployment fixture failed: ${build.logs.map((log) => log.message).join("\n")}`,
    );
  }
  server = Bun.serve({
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === "/fixture.js") {
        return new Response(script, { headers: { "Content-Type": "application/javascript" } });
      }
      return new Response(
        '<html lang="pt-BR"><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>',
        { headers: { "Content-Type": "text/html" } },
      );
    },
  });
  browser = await chromium.launch();
}, 30_000);

afterAll(async () => {
  await browser?.close();
  await server?.stop(true);
  if (directory?.startsWith(`${cacheDirectory}${sep}`) === true) {
    await rm(directory, { recursive: true, force: true });
  }
});

test("keeps one page and one polling request after 100 pages, with previous, reset and filter navigation", async () => {
  if (browser == null || server == null) {
    throw new Error("Deployment browser fixture did not start");
  }
  const context = await browser.newContext();
  await using _context = { [Symbol.asyncDispose]: async () => await context.close() };
  const page = await context.newPage();
  await page.clock.install();
  const requests: {
    readonly before?: { readonly id: string; readonly createdAt: string } | undefined;
    readonly status?: string | undefined;
  }[] = [];
  await page.route("**/deployments", async (route) => {
    const input = z
      .object({
        limit: z.literal(25),
        before: pageCursorSchema.optional(),
        status: z.string().optional(),
      })
      .parse(route.request().postDataJSON());
    requests.push(input);
    const offset = input.before == null ? 0 : Number(input.before.id);
    if (Number.isFinite(offset) === false || offset < 0) {
      throw new Error("Invalid fixture history cursor");
    }
    const rows = Array.from({ length: 25 }, (_, index) => ({
      id: String(offset + index + 1),
      createdAt: "2026-11-06T12:00:00.000Z",
      status: input.status ?? "queued",
    }));
    await route.fulfill({ json: rows });
  });
  await page.goto(server.url.href);
  await page.locator('[data-id="1"]').waitFor();
  for (let index = 1; index <= 100; index += 1) {
    await page.getByRole("button", { name: "Próxima página", exact: true }).click();
    await page.locator(`[data-id="${index * 25 + 1}"]`).waitFor();
  }
  expect(await page.locator("li").count()).toBe(25);
  expect(await page.locator("body").getAttribute("data-cache-entries")).toBe("1");
  const beforePoll = requests.length;
  await page.clock.runFor(5100);
  await page.waitForLoadState("networkidle");
  expect(requests.length - beforePoll).toBe(1);
  await page.getByRole("button", { name: "Página anterior", exact: true }).click();
  await page.locator('[data-id="2476"]').waitFor();
  await page.getByRole("button", { name: "Mais recentes", exact: true }).click();
  await page.locator('[data-id="1"]').waitFor();
  await page.getByRole("button", { name: "Próxima página", exact: true }).click();
  await page.locator('[data-id="26"]').waitFor();
  await page.getByRole("button", { name: "Falhas", exact: true }).click();
  await page.locator('[data-id="1"]').waitFor();
  expect(requests.at(-1)).toMatchObject({ status: "failed" });
  expect(requests.at(-1)?.before).toBeUndefined();
}, 30_000);
