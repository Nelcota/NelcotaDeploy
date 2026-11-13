import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import { type Browser, chromium } from "playwright";

let browser: Browser | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;
let directory: string | undefined;
const cacheDirectory = resolve("node_modules/.cache");
const navigationPath = JSON.stringify(
  join(import.meta.dir, "page-navigation.tsx").replaceAll("\\", "/"),
);
const fixture = `
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Link, RouterProvider } from "@tanstack/react-router";
import { PageNavigation } from ${navigationPath};
const params = new URL(location.href).searchParams;
const projectId = params.get("projectId") ?? "app";
const destinations = [
  { to: "/projects/$projectId", label: "Status", group: "Aplicação", primary: true, exact: true },
  { to: "/projects/$projectId/settings", label: "Configurações", group: "Configuração", primary: true, exact: false },
  { to: "/projects/$projectId/previews", label: "Ambientes de teste", group: "Publicação", primary: false, exact: true },
  { to: "/projects/$projectId/settings/build", label: "Construção", group: "Configuração", primary: false, exact: true },
  { to: "/projects/$projectId/databases", label: "Bancos de dados", group: "Dados e tarefas", primary: false, exact: true },
];
const items = destinations.map((item) => ({ ...item, params: { projectId }, href: item.to.replace("$projectId", encodeURIComponent(projectId)), renderLink: (current) => <Link to={item.to} params={{ projectId }} activeOptions={{ exact: true, includeSearch: false }} aria-current={current ? "page" : undefined} preload={false}>{item.label}</Link> }));
function App() {
  const [empty, setEmpty] = useState(false);
  return <main>
    <button onClick={() => setEmpty((value) => value === false)}>Alternar catálogo</button>
    <PageNavigation label="Páginas do projeto" items={empty ? [] : items} />
  </main>;
}
const root = createRootRoute({ component: App });
const project = createRoute({ getParentRoute: () => root, path: "/projects/$projectId" });
const settings = createRoute({ getParentRoute: () => project, path: "settings" });
const build = createRoute({ getParentRoute: () => settings, path: "build" });
const previews = createRoute({ getParentRoute: () => project, path: "previews" });
const databases = createRoute({ getParentRoute: () => project, path: "databases" });
const fallback = createRoute({ getParentRoute: () => root, path: "$" });
const router = createRouter({
  routeTree: root.addChildren([project.addChildren([settings.addChildren([build]), previews, databases]), fallback]),
  history: createMemoryHistory({ initialEntries: [params.get("path") ?? "/projects/app"] }),
});
createRoot(document.getElementById("root")).render(<RouterProvider router={router} />);
`;

beforeAll(async () => {
  await mkdir(cacheDirectory, { recursive: true });
  directory = await mkdtemp(join(cacheDirectory, "router-navigation-"));
  const entry = join(directory, "fixture.tsx");
  await Bun.write(entry, fixture);
  const build = await Bun.build({ entrypoints: [entry], target: "browser" });
  const script = build.outputs.at(0);
  if (build.success === false || script == null) {
    throw new Error(
      `Navigation fixture did not build: ${build.logs.map((log) => log.message).join("\n")}`,
    );
  }
  server = Bun.serve({
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === "/fixture.js") {
        return new Response(script, { headers: { "Content-Type": "application/javascript" } });
      }
      return new Response(
        '<!doctype html><html lang="pt-BR"><head><title>Navegação</title><style>.hidden{display:none}@media(min-width:640px){[class~="sm:hidden"]{display:none}[class~="sm:block"]{display:block}}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>',
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

async function openNavigation(path = "/projects/app", projectId = "app") {
  if (browser == null || server == null) {
    throw new Error("Navigation browser fixture has not started");
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(2000);
  let errors: string[] = [];
  page.on("pageerror", (error) => {
    errors = [...errors, error.message];
  });
  const query = new URLSearchParams({ path, projectId });
  await page.goto(`${server.url.href}?${query}`);
  await page.getByRole("navigation", { name: "Páginas do projeto" }).waitFor();
  return { page, errors: () => errors, [Symbol.asyncDispose]: async () => await context.close() };
}

test.each([
  ["/projects/app/settings/build", "app"],
  ["/projects/app/settings/build/?filter=all#details", "app"],
  ["/PROJECTS/app/SETTINGS/BUILD", "app"],
  ["/projects/my%20app/settings/build", "my app"],
])("selects the deepest destination through the router at %s", async (path, projectId) => {
  await using session = await openNavigation(path, projectId);
  const { page } = session;
  const resources = page.getByRole("button", { name: "Recursos", exact: true });
  expect(await resources.getAttribute("aria-description")).toBe("Página atual: Construção");
  expect(
    await page.getByRole("link", { name: "Configurações" }).getAttribute("aria-current"),
  ).toBeNull();
  await resources.click();
  expect(
    await page.getByRole("menuitem", { name: "Construção" }).getAttribute("aria-current"),
  ).toBe("page");
  expect(session.errors()).toEqual([]);
});

test("opens desktop resources by keyboard in the same order as mobile", async () => {
  await using session = await openNavigation();
  const { page } = session;
  const resources = page.getByRole("button", { name: "Recursos", exact: true });
  const menu = page.getByRole("menu", { name: "Recursos", exact: true });
  await resources.press("Enter");
  await menu.waitFor();
  expect(
    await menu
      .getByRole("group")
      .evaluateAll((groups) => groups.map((group) => group.getAttribute("aria-label"))),
  ).toEqual(["Configuração", "Dados e tarefas", "Publicação"]);
  expect(await menu.getByRole("menuitem").allTextContents()).toEqual([
    "Construção",
    "Bancos de dados",
    "Ambientes de teste",
  ]);
  await menu.getByRole("menuitem", { name: "Construção" }).and(page.locator(":focus")).waitFor();
  await page.keyboard.press("ArrowDown");
  await menu
    .getByRole("menuitem", { name: "Bancos de dados" })
    .and(page.locator(":focus"))
    .waitFor();
  await page.keyboard.press("Enter");
  await menu.waitFor({ state: "hidden" });
  expect(await resources.getAttribute("aria-description")).toBe("Página atual: Bancos de dados");
  expect(session.errors()).toEqual([]);
});

test("keeps primary links directly available on mobile and updates the active destination", async () => {
  await using session = await openNavigation();
  const { page } = session;
  await page.setViewportSize({ width: 320, height: 740 });
  const status = page.getByRole("link", { name: "Status", exact: true });
  const settings = page.getByRole("link", { name: "Configurações", exact: true });
  expect(await status.getAttribute("aria-current")).toBe("page");
  await settings.click();
  expect(await settings.getAttribute("aria-current")).toBe("page");
  const resources = page.getByRole("button", { name: "Recursos", exact: true });
  const sheet = page.getByRole("dialog", { name: "Recursos do projeto" });
  await resources.click();
  await sheet.getByRole("link", { name: "Construção", exact: true }).click();
  await sheet.waitFor({ state: "hidden" });
  expect(await resources.getAttribute("aria-description")).toBe("Página atual: Construção");
  await resources.click();
  const current = sheet.getByRole("link", { name: "Construção", exact: true });
  expect(await current.getAttribute("aria-current")).toBe("page");
  await page.keyboard.press("Escape");
  await sheet.waitFor({ state: "hidden" });
  expect(await resources.evaluate((element) => document.activeElement === element)).toBe(true);
  await status.click();
  expect(await status.getAttribute("aria-current")).toBe("page");
  expect(session.errors()).toEqual([]);
});

test("keeps only the parent active for a child of an exact destination", async () => {
  await using session = await openNavigation("/projects/app/settings/build/details");
  expect(
    await session.page
      .getByRole("link", { name: "Configurações", exact: true })
      .getAttribute("aria-current"),
  ).toBe("page");
  expect(session.errors()).toEqual([]);
});

test("does not match partial segments and handles an empty catalog without changing hook order", async () => {
  await using session = await openNavigation("/projects/app/settings-old");
  const { page } = session;
  expect(await page.locator("nav [aria-current]").count()).toBe(0);
  expect(await page.getByRole("button", { name: "Recursos", exact: true }).isVisible()).toBe(true);
  await page.getByRole("button", { name: "Alternar catálogo" }).click();
  expect(await page.getByRole("navigation", { name: "Páginas do projeto" }).count()).toBe(0);
  await page.getByRole("button", { name: "Alternar catálogo" }).click();
  await page.getByRole("navigation", { name: "Páginas do projeto" }).waitFor();
  expect(session.errors()).toEqual([]);
});
