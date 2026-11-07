import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import { AxeBuilder } from "@axe-core/playwright";
import { type Browser, chromium } from "playwright";
import { z } from "zod";

import { passwordSchema } from "@/shared/schemas/user.schema";

let browser: Browser | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;
let directory: string | undefined;
const cacheDirectory = resolve("node_modules/.cache");
const LOCATOR_TIMEOUT_IN_MS = 2000;
const overviewPath = JSON.stringify(join(import.meta.dir, "overview.tsx").replaceAll("\\", "/"));
const kindPath = JSON.stringify(
  join(import.meta.dir, "../forms/env-kind-toggle.tsx").replaceAll("\\", "/"),
);
const avatarPath = JSON.stringify(
  join(import.meta.dir, "../account/avatar-image.ts").replaceAll("\\", "/"),
);
const credentialsPath = JSON.stringify(
  join(import.meta.dir, "../../admin/users/credentials/account-defaults.ts").replaceAll("\\", "/"),
);
const fixture = `
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { SegmentedControl } from ${overviewPath};
import { VariableKindToggle } from ${kindPath};
import { bytesToBase64 } from ${avatarPath};
import { generateAccountPassword } from ${credentialsPath};
const params = new URL(location.href).searchParams;
const mode = params.get("mode");
const labels = ["Primeiro", "Segundo", "Terceiro"];
const values = mode === "string" ? ["one", "two", "three"] : [0, 1, 2];
const count = mode === "empty" ? 0 : mode === "one" ? 1 : 3;
const options = labels.slice(0, count).map((label, index) => ({ label, value: values[index] }));
function App() {
  useEffect(() => { document.body.dataset.ready = "true"; }, []);
  const [value, setValue] = useState(mode === "string" ? "one" : Number(params.get("initial") ?? "0"));
  const [kind, setKind] = useState("plain");
  const [encoded, setEncoded] = useState("");
  const [passwords, setPasswords] = useState("");
  return <main>
    <button>Antes</button>
    <SegmentedControl label="Período" options={options} value={value} onChange={setValue} />
    <button>Depois</button><output aria-label="Valor escolhido">{typeof value}:{String(value)}</output>
    <span id="kind-label">Tipo de variável</span><p id="kind-hint">Escolha como armazenar o valor.</p>
    <VariableKindToggle id="kind" value={kind} onChange={setKind} describedBy="kind-hint" />
    <button onClick={() => setEncoded(bytesToBase64(Uint8Array.from({ length: 100000 }, (_, index) => index % 256)))}>Codificar imagem</button>
    <output aria-label="Imagem codificada">{encoded}</output>
    <button onClick={() => setPasswords(JSON.stringify(Array.from({ length: 100 }, generateAccountPassword)))}>Gerar senhas</button>
    <output aria-label="Senhas geradas">{passwords}</output>
  </main>;
}
createRoot(document.getElementById("root")).render(<App />);
`;

beforeAll(async () => {
  await mkdir(cacheDirectory, { recursive: true });
  directory = await mkdtemp(join(cacheDirectory, "choice-controls-"));
  const entry = join(directory, "fixture.tsx");
  await Bun.write(entry, fixture);
  const build = await Bun.build({ entrypoints: [entry], target: "browser" });
  const script = build.outputs.at(0);
  if (build.success === false || script == null) {
    throw new Error(
      `Choice control fixture did not build: ${build.logs.map((message) => message.message).join("\n")}`,
    );
  }
  server = Bun.serve({
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === "/fixture.js") {
        return new Response(script, { headers: { "Content-Type": "application/javascript" } });
      }
      return new Response(
        '<!doctype html><html lang="pt-BR"><head><title>Seletores</title></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>',
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

async function openControl(query = "") {
  if (browser == null || server == null) {
    throw new Error("Choice control browser fixture has not started");
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(LOCATOR_TIMEOUT_IN_MS);
  await page.goto(`${server.url.href}${query}`);
  await page.locator('body[data-ready="true"]').waitFor();
  return { page, [Symbol.asyncDispose]: async () => await context.close() };
}

test.each([
  ["ArrowRight", 0, { value: 1, label: "Segundo" }],
  ["ArrowDown", 2, { value: 0, label: "Primeiro" }],
  ["ArrowLeft", 0, { value: 2, label: "Terceiro" }],
  ["ArrowUp", 2, { value: 1, label: "Segundo" }],
  ["Home", 2, { value: 0, label: "Primeiro" }],
  ["End", 0, { value: 2, label: "Terceiro" }],
] as const)("moves focus and selection with %s", async (key, current, expected) => {
  await using session = await openControl(`?initial=${current}`);
  const { page } = session;
  const group = page.getByRole("radiogroup", { name: "Período" });
  await group.getByRole("radio", { checked: true }).focus();
  await page.keyboard.down(key);
  await page.waitForFunction(
    (text) => document.activeElement?.textContent === text,
    expected.label,
  );
  await group.getByRole("radio", { name: expected.label, checked: true }).waitFor();
  expect(await group.getByRole("radio", { name: expected.label }).isChecked()).toBe(true);
  expect(await page.getByLabel("Valor escolhido").textContent()).toBe(`number:${expected.value}`);
  await page.keyboard.up(key);
});

test.each(["ArrowLeft", "ArrowRight", "Home", "End"])(
  "keeps the only option selected with %s",
  async (key) => {
    await using session = await openControl("?mode=one");
    const radio = session.page.getByRole("radio", { name: "Primeiro" });
    await radio.focus();
    await session.page.keyboard.press(key);
    expect(await radio.isChecked()).toBe(true);
    expect(await session.page.getByLabel("Valor escolhido").textContent()).toBe("number:0");
  },
);

test("handles an empty option list without inventing a selection", async () => {
  await using session = await openControl("?mode=empty");
  const group = session.page.getByRole("radiogroup", { name: "Período" });
  await group.press("Home");
  expect(await group.getByRole("radio").count()).toBe(0);
  expect(await session.page.getByLabel("Valor escolhido").textContent()).toBe("number:0");
});

test.each([-1, 3, Number.NaN, Number.POSITIVE_INFINITY, 1.5])(
  "does not check an unavailable selection %p",
  async (initial) => {
    await using session = await openControl(`?initial=${initial}`);
    const group = session.page.getByRole("radiogroup", { name: "Período" });
    expect(await group.getByRole("radio", { checked: true }).count()).toBe(0);
    await group.getByRole("radio", { name: "Segundo" }).click();
    expect(await session.page.getByLabel("Valor escolhido").textContent()).toBe("number:1");
  },
);

test("leaves Tab navigation to the browser with one stop per radio group", async () => {
  await using session = await openControl();
  const { page } = session;
  await page.getByRole("button", { name: "Antes" }).focus();
  await page.keyboard.press("Tab");
  expect(
    await page
      .getByRole("radio", { name: "Primeiro" })
      .evaluate((radio) => radio === document.activeElement),
  ).toBe(true);
  await page.keyboard.press("Tab");
  expect(
    await page
      .getByRole("button", { name: "Depois" })
      .evaluate((button) => button === document.activeElement),
  ).toBe(true);
  expect(await page.getByLabel("Valor escolhido").textContent()).toBe("number:0");
});

test("preserves string option values when selecting by pointer", async () => {
  await using session = await openControl("?mode=string");
  await session.page.getByRole("radio", { name: "Segundo" }).click();
  expect(await session.page.getByLabel("Valor escolhido").textContent()).toBe("string:two");
});

test("moves between variable kinds using all four arrow keys", async () => {
  await using session = await openControl();
  const { page } = session;
  const group = page.getByRole("radiogroup", { name: "Tipo de variável" });
  await group.getByRole("radio", { name: "Configuração" }).focus();
  for (const key of ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"]) {
    await page.keyboard.down(key);
    await group.getByRole("radio", { name: "Secret", checked: true }).waitFor();
    await page.keyboard.up(key);
    await page.keyboard.down(key);
    await group.getByRole("radio", { name: "Configuração", checked: true }).waitFor();
    await page.keyboard.up(key);
  }
  expect(await group.getAttribute("aria-describedby")).toBe("kind-hint");
});

test("encodes large avatar payloads with native browser Base64", async () => {
  await using session = await openControl();
  await session.page.getByRole("button", { name: "Codificar imagem" }).click();
  const encoded = await session.page.getByLabel("Imagem codificada").textContent();
  const bytes = Uint8Array.from({ length: 100_000 }, (_, index) => index % 256);
  expect(encoded).toBe(Buffer.from(bytes).toString("base64"));
});

test("generates distinct browser passwords with unchanged entropy and URL-safe encoding", async () => {
  await using session = await openControl();
  await session.page.getByRole("button", { name: "Gerar senhas" }).click();
  const text = await session.page.getByLabel("Senhas geradas").textContent();
  if (text == null) {
    throw new Error("The browser did not return generated fixture passwords");
  }
  const decoded: unknown = JSON.parse(text);
  const passwords = z.array(passwordSchema).length(100).parse(decoded);
  expect(new Set(passwords).size).toBe(100);
  expect(
    passwords.every((password) => password.length === 24 && /^[A-Za-z0-9_-]+$/.test(password)),
  ).toBe(true);
});

test("keeps both choice controls accessible", async () => {
  await using session = await openControl();
  const result = await new AxeBuilder({ page: session.page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    result.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);
});
