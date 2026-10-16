// Exercise an isolated local dev panel, including a real virtual WebAuthn device.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { createHmac } = require("node:crypto");

const base = process.env.NELCOTA_E2E_BASE_URL || "http://localhost:8080";
if (!["127.0.0.1", "localhost"].includes(new URL(base).hostname)) {
  throw new Error("Browser tests require a loopback development panel.");
}

function totp(secret, ahead = 0) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes = [];
  let bits = 0,
    value = 0;
  for (const character of secret.replace(/=+$/, "").toUpperCase()) {
    value = (value << 5) | alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 255);
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(
    BigInt(Math.floor((Date.now() / 1000 + ahead) / 30)),
  );
  const digest = createHmac("sha1", Buffer.from(bytes))
    .update(counter)
    .digest();
  return String(
    (digest.readUInt32BE(digest[19] & 15) & 0x7fffffff) % 1000000,
  ).padStart(6, "0");
}

test(
  "browser: account, applications, deploys, logs, settings, permissions and passkeys",
  { timeout: 180000 },
  async (t) => {
    if (!process.env.NELCOTA_E2E_BASE_URL) {
      try {
        await fetch(base + "/healthz", { signal: AbortSignal.timeout(500) });
        throw new Error(
          "Port 8080 is occupied. Stop the dev panel before running isolated tests.",
        );
      } catch (error) {
        if (error.message.startsWith("Port 8080")) throw error;
      }
      const dir = await mkdtemp(path.join(tmpdir(), "nelcota-browser-"));
      const server = spawn(path.resolve("bin/nelcota-panel"), ["dev"], {
        env: { ...process.env, NELCOTA_DEV_DATA_DIR: dir },
        stdio: "ignore",
      });
      t.after(async () => {
        const stopped = new Promise((resolve) => server.once("exit", resolve));
        server.kill("SIGTERM");
        await stopped;
        await rm(dir, { recursive: true, force: true });
      });
    }
    for (let n = 0; n < 80; n++) {
      try {
        if ((await fetch(base + "/healthz")).ok) break;
      } catch {
        /* Wait for startup. */
      }
      if (n === 79) throw new Error("Dev panel did not become ready.");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const browser = await chromium.launch({
      headless: true,
      slowMo: 150,
      executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    t.after(() => browser.close());
    const context = await browser.newContext();
    const page = await context.newPage();
    const failures = [];
    page.on("response", (response) => {
      if (response.status() >= 400)
        console.log(
          "[browser HTTP]",
          response.status(),
          new URL(response.url()).pathname,
        );
    });
    t.after(async () => {
      console.log("[browser errors]", JSON.stringify(failures));
      if (!page.isClosed())
        console.log(
          "[browser form errors]",
          await page.locator(".error").allTextContents(),
        );
    });
    page.on("pageerror", (error) => failures.push(error.message));
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        /Content Security Policy|Refused to/.test(message.text())
      )
        failures.push(message.text());
    });
    const navigate = async (url) => {
      await page.goto(base + url);
      await page.getByRole("heading", { level: 1 }).waitFor();
    };
    const button = (name) => page.getByRole("button", { name, exact: true });
    await navigate("/");
    assert.equal(new URL(page.url()).pathname, "/login");
    assert.equal(await page.locator("body").getAttribute("data-dev"), "true");
    await button("Entrar no ambiente de desenvolvimento").click();
    await page
      .getByRole("heading", { name: "Visão geral", exact: true })
      .waitFor();
    await page.getByRole("heading", { name: "loja", exact: true }).waitFor();
    assert.equal(
      await page.locator("main .grid").first().locator(".card").count(),
      3,
    );
    await button("Nova aplicação").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Nome", { exact: true }).fill("browser-app");
    await dialog
      .getByLabel("Repositório HTTPS do GitHub")
      .fill("https://github.com/example/browser-app");
    await dialog
      .getByRole("button", { name: "Criar aplicação", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "browser-app", exact: true })
      .waitFor();
    await button("Novo deploy").click();
    await dialog.getByLabel("SHA do commit").fill("a".repeat(40));
    await dialog
      .getByLabel("Mensagem", { exact: true })
      .fill("<img src=x onerror=alert(1)>");
    await dialog
      .getByRole("button", { name: "Enfileirar deploy", exact: true })
      .click();
    await page
      .getByText("success", { exact: true })
      .first()
      .waitFor({ timeout: 20000 });
    assert.equal(await page.locator("main img").count(), 0);
    await page
      .getByText("<img src=x onerror=alert(1)>", { exact: true })
      .waitFor();
    await button("Logs").first().click();
    await page
      .getByRole("heading", { name: "Log de build", exact: true })
      .waitFor();
    await page.waitForFunction(() =>
      document.querySelector(".log")?.textContent.includes("[dev]"),
    );
    await page
      .getByRole("textbox", { name: "Buscar nos logs", exact: true })
      .fill("starting");
    assert.ok((await page.locator(".log").innerText()).includes("starting"));
    await page
      .getByRole("textbox", { name: "Buscar nos logs", exact: true })
      .fill("");
    const downloaded = page.waitForEvent("download");
    await button("Baixar").click();
    assert.ok((await downloaded).suggestedFilename().endsWith(".log"));
    // A late configuration request must not replace the newly selected log tab.
    await page.route("**/api/apps/*/env", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.continue();
    });
    await button("Configurações").click();
    await button("Logs ao vivo").click();
    await page
      .getByRole("heading", { name: "Logs de runtime", exact: true })
      .waitFor();
    await new Promise((resolve) => setTimeout(resolve, 800));
    assert.equal(
      await page
        .getByRole("heading", { name: "Logs de runtime", exact: true })
        .count(),
      1,
    );
    await page.unroute("**/api/apps/*/env");

    await button("Configurações").click();
    await page.getByLabel("Chave", { exact: true }).fill("BROWSER_SECRET");
    await page
      .getByLabel("Novo valor", { exact: true })
      .fill("browser-private-value");
    await button("Salvar variável").click();
    await page
      .getByRole("cell", { name: "BROWSER_SECRET", exact: true })
      .waitFor();
    assert.equal(
      (await page.locator("body").innerText()).includes(
        "browser-private-value",
      ),
      false,
    );
    page.on("dialog", (nativeDialog) => nativeDialog.accept());
    await button("Remover").click();
    await page
      .getByText("Nenhuma variável configurada.", { exact: true })
      .waitFor();
    await page.getByLabel("Réplicas", { exact: true }).fill("2");
    await button("Salvar configuração").click();
    await page
      .getByText("Configuração salva. O agent recebe o estado atualizado.", {
        exact: true,
      })
      .waitFor();
    await button("Parar").click();
    await page
      .getByText("Estado desejado atualizado.", { exact: true })
      .waitFor();
    await button("Excluir aplicação").click();
    await page
      .getByRole("heading", { name: "Visão geral", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("heading", { name: "browser-app", exact: true })
        .count(),
      0,
    );
    await navigate("/servers");
    await page
      .getByRole("heading", { name: "Servidor loja", exact: true })
      .waitFor();
    await button("Adicionar servidor").click();
    await dialog.getByLabel("Nome", { exact: true }).fill("Browser server");
    await dialog.getByLabel("IPv4 WireGuard").fill("10.77.0.20");
    await dialog
      .getByRole("button", { name: "Gerar convite", exact: true })
      .click();
    await dialog
      .getByRole("heading", { name: "Convite do servidor", exact: true })
      .waitFor();
    assert.match(await dialog.locator("pre").innerText(), /Token:/);
    await dialog.getByRole("button", { name: "Fechar", exact: true }).click();
    await page
      .getByRole("heading", { name: "Browser server", exact: true })
      .waitFor();
    await navigate("/settings");
    await page
      .getByRole("heading", { name: "Tokens de API", exact: true })
      .waitFor();
    await page.getByLabel("Nome do token").fill("Browser token");
    await button("Criar backup").click();
    await page
      .getByText("applied", { exact: true })
      .waitFor({ timeout: 30000 });
    assert.equal(
      await page.getByLabel("Nome do token").inputValue(),
      "Browser token",
      "Operation polling discarded a draft form",
    );

    await page.getByLabel("apps:read", { exact: true }).check();
    await button("Criar token").click();
    await dialog
      .getByRole("heading", { name: "Token de API", exact: true })
      .waitFor();
    assert.match(await dialog.locator("pre").innerText(), /^nd_/);
    await dialog.getByRole("button", { name: "Fechar", exact: true }).click();
    await navigate("/settings");
    await page
      .getByRole("row")
      .filter({ hasText: "Browser token" })
      .getByRole("button", { name: "Revogar", exact: true })
      .click();
    await page.getByText("Token revogado.", { exact: true }).waitFor();
    await page.getByLabel("Nome", { exact: true }).fill("Browser Member");
    await page
      .getByLabel("E-mail", { exact: true })
      .fill("browser-member@example.test");
    await button("Convidar usuário").click();
    await dialog
      .getByRole("heading", { name: "Convite de usuário", exact: true })
      .waitFor();
    const invitation = (await dialog.locator("pre").innerText()).match(
      /Token: (\S+)/,
    )[1];
    await dialog.getByRole("button", { name: "Fechar", exact: true }).click();
    await button("Sair da conta").click();
    await page
      .getByRole("heading", { name: "Entrar com passkey", exact: true })
      .waitFor();
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    await navigate("/register");
    await page.getByLabel("Convite de acesso").fill(invitation);
    await button("Registrar passkey").click();
    await page
      .getByRole("heading", { name: "Entrar com passkey", exact: true })
      .waitFor();
    await page
      .getByLabel("E-mail", { exact: true })
      .fill("browser-member@example.test");
    await button("Entrar").click();
    await page
      .getByRole("heading", { name: "Visão geral", exact: true })
      .waitFor();
    assert.equal(await button("Nova aplicação").count(), 0);
    await navigate("/settings");
    await page
      .getByText("Ajustes restritos ao administrador.", { exact: true })
      .waitFor();
    await navigate("/security");
    await page
      .getByRole("heading", { name: "Segurança da conta", exact: true })
      .waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "Mobile viewport overflows",
    );
    await button("Alternar tema").click();
    assert.equal(
      await page.locator("html").getAttribute("data-theme"),
      "light",
    );
    // Continue with independent security journeys through the real UI and backend.
    await button("Configurar TOTP").click();
    await dialog
      .getByRole("heading", { name: "Configurar autenticador", exact: true })
      .waitFor();
    const otpSecret = new URL(
      await dialog.locator("pre").innerText(),
    ).searchParams.get("secret");
    await dialog
      .getByLabel("Código TOTP", { exact: true })
      .fill(totp(otpSecret));
    await dialog
      .getByRole("button", { name: "Ativar TOTP", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Entrar com passkey", exact: true })
      .waitFor();
    await page
      .getByLabel("E-mail", { exact: true })
      .fill("browser-member@example.test");
    await button("Entrar").click();
    await page
      .getByRole("heading", { name: "Confirmar segundo fator", exact: true })
      .waitFor();
    await page.getByLabel("Código", { exact: true }).fill(totp(otpSecret, 30));
    await button("Verificar").click();
    await page
      .getByRole("heading", { name: "Visão geral", exact: true })
      .waitFor();
    await navigate("/security");
    await button("Gerar códigos").click();
    await dialog
      .getByRole("heading", { name: "Códigos de recuperação", exact: true })
      .waitFor();
    const recovery = (await dialog.locator("pre").innerText()).split("\n")[0];
    await dialog.getByRole("button", { name: "Fechar", exact: true }).click();
    await button("Sair da conta").click();
    await page
      .getByRole("heading", { name: "Entrar com passkey", exact: true })
      .waitFor();
    // Allow the actual login rate limiter to refill between security ceremonies.
    await new Promise((resolve) => setTimeout(resolve, 20000));
    await page
      .getByLabel("E-mail", { exact: true })
      .fill("browser-member@example.test");
    await button("Entrar").click();
    await page
      .getByRole("heading", { name: "Confirmar segundo fator", exact: true })
      .waitFor();
    await page.getByLabel("Código", { exact: true }).fill(recovery);
    await button("Verificar").click();
    await page
      .getByRole("heading", { name: "Visão geral", exact: true })
      .waitFor();
    await navigate("/security");
    await button("Remover TOTP").click();
    await page
      .getByRole("heading", { name: "Entrar com passkey", exact: true })
      .waitFor();
    assert.deepEqual(failures, []);
  },
);
