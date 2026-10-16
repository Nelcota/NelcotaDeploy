const $ = (s, root = document) => root.querySelector(s);
const content = $("#content");
const modal = $("#modal");
const page = document.body.dataset.view;
const appID = document.body.dataset.app;
let session = null;
let pendingSecondFactor = "";
let noticeTimer;
const streams = new Map();
const metricViews = new Map();
let disposed = false;

// All server-provided strings reach textContent or form values, never HTML.
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "text") node.textContent = value ?? "";
    else if (key === "class") node.className = value;
    else if (key.startsWith("on"))
      node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child != null) node.append(child);
  return node;
}
const text = (value, tag = "p", cls = "") =>
  el(tag, { text: value, class: cls });
const link = (label, href) =>
  el("a", { text: label, href, class: "text-link" });
const badge = (value) =>
  text(
    value || "—",
    "span",
    `badge ${["success", "failed", "online", "offline", "queued", "building", "starting", "waiting", "cancelled"].includes(value) ? value : ""}`,
  );
const time = (stamp) =>
  stamp
    ? new Date(typeof stamp === "number" ? stamp * 1000 : stamp).toLocaleString(
        "pt-BR",
      )
    : "—";
const bytes = (value) => `${((value || 0) / 1048576).toFixed(0)} MiB`;
const empty = (message) => text(message, "p", "empty");
const actions = (...nodes) => el("div", { class: "actions" }, nodes);
function report(error) {
  notify(error?.message || "Não foi possível concluir a operação.", true);
}
function notify(message, error = false) {
  const node = $("#notice");
  node.textContent = message;
  node.classList.toggle("error", error);
  node.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    node.hidden = true;
  }, 6500);
}
function button(label, action, cls = "") {
  return el("button", {
    text: label,
    type: "button",
    class: cls,
    onclick: async (event) => {
      const node = event.currentTarget;
      if (node.disabled) return;
      node.disabled = true;
      try {
        await action(node);
      } catch (error) {
        report(error);
      } finally {
        node.disabled = false;
      }
    },
  });
}
function heading(title, description, ...buttons) {
  return el("div", { class: "heading" }, [
    el("div", {}, [text(title, "h1"), text(description)]),
    actions(...buttons),
  ]);
}
function card(title, ...children) {
  return el("section", { class: "card" }, [text(title, "h2"), ...children]);
}
function table(headers, rows) {
  return el("div", { class: "table-wrap" }, [
    el("table", {}, [
      el("thead", {}, [
        el(
          "tr",
          {},
          headers.map((h) => text(h, "th")),
        ),
      ]),
      el(
        "tbody",
        {},
        rows.map((row) =>
          el(
            "tr",
            {},
            row.map((value) =>
              el("td", {}, [
                value instanceof Node
                  ? value
                  : document.createTextNode(String(value ?? "—")),
              ]),
            ),
          ),
        ),
      ),
    ]),
  ]);
}
function field(label, name, value = "", type = "text", extra = {}) {
  const input = el(type === "textarea" ? "textarea" : "input", {
    name,
    value: value ?? "",
    ...(type === "textarea" ? {} : { type }),
    ...extra,
  });
  if (type === "checkbox") input.checked = Boolean(value);
  return el(
    "label",
    { class: type === "checkbox" ? "check" : "" },
    type === "checkbox"
      ? [input, document.createTextNode(label)]
      : [document.createTextNode(label), input],
  );
}
function select(label, name, options, value) {
  return el("label", {}, [
    document.createTextNode(label),
    el(
      "select",
      { name },
      options.map(([id, title]) =>
        el("option", {
          value: id,
          text: title,
          selected: String(id) === String(value),
        }),
      ),
    ),
  ]);
}
function form(fields, label, submit) {
  const error = text("", "p", "error");
  error.setAttribute("role", "alert");
  const node = el("form", {}, [
    el("div", { class: "form-grid" }, fields),
    error,
    el("button", { text: label, type: "submit" }),
  ]);
  node.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitter = $("button[type=submit]", node);
    if (submitter.disabled || !node.reportValidity()) return;
    submitter.disabled = true;
    error.textContent = "";
    try {
      await submit(new FormData(node), node);
    } catch (failure) {
      error.textContent = failure.message || "Operação não concluída.";
    } finally {
      submitter.disabled = false;
    }
  });
  return node;
}
function dialog(title, ...children) {
  if (modal.open) modal.close();
  $("#modal-title").textContent = title;
  $("#modal-content").replaceChildren(...children);
  modal.showModal();
}
modal.addEventListener("close", () => {
  if (!modal.open) $("#modal-content").replaceChildren();
});
function secret(title, value) {
  dialog(
    title,
    text(
      "Exibido apenas agora. Guarde em local privado; não compartilhe.",
      "p",
      "help",
    ),
    text(value, "pre", "sensitive"),
  );
}
async function api(path, method = "GET", body, attempt = 0) {
  if (!path.startsWith("/api/")) throw new Error("Destino de API inválido.");
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (session?.csrf_token) headers["X-CSRF-Token"] = session.csrf_token;
  const response = await fetch(path, {
    method,
    headers,
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 429 && method === "GET" && attempt === 0) {
    const seconds = Math.min(
      30,
      Math.max(1, Number(response.headers.get("Retry-After")) || 10),
    );
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    if (disposed) throw new Error("Página encerrada.");
    return api(path, method, body, attempt + 1);
  }
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && !["login", "register"].includes(page))
      location.assign("/login");
    const error = new Error(
      data.message ||
        (response.status === 429
          ? "Muitas requisições. Aguarde alguns segundos."
          : "Não foi possível concluir a solicitação."),
    );
    error.status = response.status;
    throw error;
  }
  return data;
}
async function mutate(path, method = "POST", body = {}) {
  return api(path, method, body);
}
let sessionCheck = null;
let lastSessionCheck = 0;
function checkDisconnectedSession() {
  if (disposed || sessionCheck || Date.now() - lastSessionCheck < 5000) return;
  lastSessionCheck = Date.now();
  sessionCheck = api("/api/session")
    .then((fresh) => {
      if (session && fresh.user.role !== session.user.role) location.reload();
      session = fresh;
    })
    .catch((error) => {
      if (error.status === 401)
        for (const stream of streams.values()) stream.close();
    })
    .finally(() => {
      sessionCheck = null;
    });
}
function watch(topic, kinds, callback, reconnect = () => {}) {
  if (disposed) return () => {};
  streams.get(topic)?.close();
  let source,
    retryTimer,
    opened = false,
    stopped = false;
  const handle = {
    close() {
      stopped = true;
      clearTimeout(retryTimer);
      source?.close();
      if (streams.get(topic) === handle) streams.delete(topic);
    },
  };
  const connect = () => {
    if (stopped || disposed) return;
    source = new EventSource(`/api/events?topic=${encodeURIComponent(topic)}`);
    source.addEventListener("open", () => {
      $("#connection").textContent = "● Conectado";
      if (opened) Promise.resolve(reconnect()).catch(report);
      opened = true;
    });
    source.addEventListener("error", () => {
      $("#connection").textContent = "Reconectando…";
      checkDisconnectedSession();
      // Browsers retry network disconnects themselves, but permanently close
      // EventSource after HTTP 429. Back off instead of retrying in a tight loop.
      if (source.readyState === EventSource.CLOSED) {
        source.close();
        clearTimeout(retryTimer);
        retryTimer = setTimeout(connect, 10000);
      }
    });
    for (const kind of kinds)
      source.addEventListener(kind, (event) => {
        try {
          callback(kind, JSON.parse(event.data));
        } catch (error) {
          report(error);
        }
      });
  };
  streams.set(topic, handle);
  connect();
  return () => handle.close();
}
function refreshQueue(load) {
  let timer,
    running = false,
    again = false;
  return function schedule() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (disposed) return;
      if (running) {
        again = true;
        return;
      }
      running = true;
      try {
        await load();
      } catch (error) {
        report(error);
      } finally {
        running = false;
        if (again) {
          again = false;
          schedule();
        }
      }
    }, 350);
  };
}
function safeGitHub(raw) {
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.username ||
    url.password ||
    url.port
  )
    throw new Error("Destino GitHub inválido.");
  return url.href;
}
function decode(raw) {
  return Uint8Array.from(atob(raw.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0),
  );
}
function encode(raw) {
  return btoa(String.fromCharCode(...new Uint8Array(raw)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function credentialJSON(credential) {
  if (credential.toJSON) return credential.toJSON();
  const r = credential.response;
  const response = { clientDataJSON: encode(r.clientDataJSON) };
  if (r.attestationObject) {
    response.attestationObject = encode(r.attestationObject);
    response.transports = r.getTransports?.() || [];
  } else {
    response.authenticatorData = encode(r.authenticatorData);
    response.signature = encode(r.signature);
    response.userHandle = r.userHandle ? encode(r.userHandle) : null;
  }
  return {
    id: credential.id,
    rawId: encode(credential.rawId),
    type: credential.type,
    response,
    clientExtensionResults: credential.getClientExtensionResults(),
  };
}
function optionsJSON(options, registration) {
  const key = structuredClone(options.publicKey);
  if (registration && PublicKeyCredential.parseCreationOptionsFromJSON)
    return PublicKeyCredential.parseCreationOptionsFromJSON(key);
  if (!registration && PublicKeyCredential.parseRequestOptionsFromJSON)
    return PublicKeyCredential.parseRequestOptionsFromJSON(key);
  key.challenge = decode(key.challenge);
  if (registration) key.user.id = decode(key.user.id);
  for (const credential of key[
    registration ? "excludeCredentials" : "allowCredentials"
  ] || [])
    credential.id = decode(credential.id);
  return key;
}
async function passkey(registration, enrollment = "", email = "") {
  if (!window.PublicKeyCredential || !navigator.credentials)
    throw new Error("Este navegador não oferece passkeys nesta origem segura.");
  const begin = await mutate(
    `/api/auth/${registration ? "register" : "login"}/begin`,
    "POST",
    registration ? { enrollment_token: enrollment } : { email },
  );
  const key = optionsJSON(begin.options, registration);
  const credential = registration
    ? await navigator.credentials.create({ publicKey: key })
    : await navigator.credentials.get({ publicKey: key });
  if (!credential) throw new Error("Cerimônia cancelada.");
  return mutate(
    `/api/auth/${registration ? "register" : "login"}/finish`,
    "POST",
    { ceremony_id: begin.ceremony_id, credential: credentialJSON(credential) },
  );
}
function loginView(registration = false) {
  pendingSecondFactor = "";
  const panel = card(
    registration ? "Primeiro acesso" : "Entrar com passkey",
    text(
      registration
        ? "Use o convite de uso único recebido do administrador para registrar sua passkey."
        : "Seu acesso à infraestrutura, protegido por passkey.",
      "p",
      "muted",
    ),
  );
  const controls = registration
    ? [
        field("Convite de acesso", "token", "", "password", {
          required: true,
          autocomplete: "off",
        }),
      ]
    : [
        field("E-mail", "email", "", "email", {
          required: true,
          autocomplete: "username",
        }),
      ];
  panel.append(
    form(
      controls,
      registration ? "Registrar passkey" : "Entrar",
      async (data) => {
        const result = await passkey(
          registration,
          String(data.get("token") || "").trim(),
          String(data.get("email") || "").trim(),
        );
        if (registration) {
          notify("Passkey registrada. Entre para continuar.");
          location.assign("/login");
          return;
        }
        if (result.requires_totp) {
          pendingSecondFactor = result.challenge;
          secondFactor(panel);
        } else location.assign("/");
      },
    ),
  );
  panel.append(
    link(
      registration ? "Já tenho uma conta" : "Tenho um convite",
      registration ? "/login" : "/register",
    ),
  );
  if (!registration && document.body.dataset.dev === "true")
    panel.append(
      text("Ambiente local com agents simulados.", "p", "help"),
      button(
        "Entrar no ambiente de desenvolvimento",
        async () => {
          await mutate("/api/dev/session");
          location.assign("/");
        },
        "secondary",
      ),
    );
  content.replaceChildren(
    el("div", { class: "login" }, [
      heading("Bem-vindo ao Nelcota", "Seu código, seus servidores."),
      panel,
    ]),
  );
}
function secondFactor(panel) {
  panel.replaceChildren(
    text("Confirmar segundo fator", "h2"),
    text(
      "Use seu TOTP ou um código de recuperação. Uma tentativa inválida exige reiniciar o login.",
      "p",
      "help",
    ),
    form(
      [
        field("Código", "code", "", "text", {
          required: true,
          autocomplete: "one-time-code",
        }),
      ],
      "Verificar",
      async (data) => {
        const challenge = pendingSecondFactor;
        pendingSecondFactor = "";
        if (!challenge)
          throw new Error(
            "Refaça o login com passkey para gerar um novo desafio.",
          );
        const code = String(data.get("code")).trim();
        await mutate(
          code.replace(/-/g, "").length === 32
            ? "/api/auth/recovery/verify"
            : "/api/auth/totp/verify",
          "POST",
          { challenge, code },
        );
        location.assign("/");
      },
    ),
    button("Reiniciar login", () => loginView()),
  );
}
async function deployDialog(app, sha = "", origin = "manual") {
  dialog(
    origin === "rollback" ? "Reconstruir versão anterior" : "Novo deploy",
    text(
      "Informe o SHA completo do commit. A aplicação precisa de um Dockerfile.",
      "p",
      "help",
    ),
    form(
      [
        field("SHA do commit", "sha", sha, "text", {
          required: true,
          pattern: "(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})",
          maxlength: 64,
        }),
        field("Mensagem", "message", "", "text", { maxlength: 1000 }),
        field("Build limpo (sem cache)", "clean", false, "checkbox"),
      ],
      "Enfileirar deploy",
      async (data) => {
        await mutate("/api/deployments", "POST", {
          app_id: app.id,
          sha: String(data.get("sha")).trim(),
          message: String(data.get("message")),
          clean: data.has("clean"),
          origin,
        });
        modal.close();
        notify("Deploy enfileirado.");
      },
    ),
  );
}
function appForm(app, servers, done) {
  const cfg = app?.config || {
    memory_bytes: 268435456,
    nano_cpus: 1e9,
    replicas: 1,
    port: 8080,
    health_path: "/",
    health_timeout: 60,
    dockerfile: "Dockerfile",
    cache_enabled: true,
    domains: [],
  };
  const serverField = select(
    "Servidor",
    "server_id",
    servers.map((s) => [s.id, s.name]),
    app?.server_id,
  );
  if (app) $("select", serverField).disabled = true;
  const node = form(
    [
      field("Nome", "name", app?.name || "", "text", {
        required: true,
        maxlength: 80,
      }),
      serverField,
      field(
        "Repositório HTTPS do GitHub",
        "repository",
        app?.repository || "",
        "url",
        { required: true },
      ),
      field("Branch", "branch", app?.branch || "main", "text", {
        required: true,
        maxlength: 200,
      }),
      field(
        "Domínios separados por vírgula",
        "domains",
        cfg.domains.join(", "),
      ),
      field("Dockerfile", "dockerfile", cfg.dockerfile, "text", {
        required: true,
      }),
      field("Memória (MiB)", "memory", cfg.memory_bytes / 1048576, "number", {
        min: 32,
        max: 65536,
        required: true,
      }),
      field("CPUs", "cpu", cfg.nano_cpus / 1e9, "number", {
        min: 0.01,
        max: 64,
        step: 0.01,
        required: true,
      }),
      field("Réplicas", "replicas", cfg.replicas, "number", {
        min: 1,
        max: 16,
        required: true,
      }),
      field("Porta interna", "port", cfg.port, "number", {
        min: 1,
        max: 65535,
        required: true,
      }),
      field("Healthcheck", "health_path", cfg.health_path, "text", {
        required: true,
      }),
      field(
        "Timeout de saúde (s)",
        "health_timeout",
        cfg.health_timeout,
        "number",
        { min: 1, max: 600, required: true },
      ),
      field(
        "ID da instalação GitHub App (0 para público)",
        "installation_id",
        cfg.installation_id || 0,
        "number",
        { min: 0, step: 1 },
      ),
      field("Usar cache de build", "cache", cfg.cache_enabled, "checkbox"),
    ],
    app ? "Salvar configuração" : "Criar aplicação",
    async (data) => {
      const config = {
        ...cfg,
        domains: String(data.get("domains"))
          .split(",")
          .map((d) => d.trim().toLowerCase())
          .filter(Boolean),
        dockerfile: String(data.get("dockerfile")).trim(),
        memory_bytes: Number(data.get("memory")) * 1048576,
        nano_cpus: Math.round(Number(data.get("cpu")) * 1e9),
        replicas: Number(data.get("replicas")),
        port: Number(data.get("port")),
        health_path: String(data.get("health_path")),
        health_timeout: Number(data.get("health_timeout")),
        installation_id: Number(data.get("installation_id")),
        cache_enabled: data.has("cache"),
      };
      const saved = await mutate(
        app ? `/api/apps/${encodeURIComponent(app.id)}` : "/api/apps",
        app ? "PUT" : "POST",
        {
          name: String(data.get("name")).trim(),
          server_id: app?.server_id || String(data.get("server_id")),
          repository: String(data.get("repository")).trim(),
          branch: String(data.get("branch")).trim(),
          config,
        },
      );
      notify("Configuração salva. O agent recebe o estado atualizado.");
      await done(saved);
    },
  );
  return node;
}
function serverMetrics(server) {
  const node = text("Aguardando telemetria…", "p", "metrics");
  metricViews.set(server.id, node);
  return node;
}
function metricEvent(_, data) {
  if (!data?.metrics) return;
  const node = metricViews.get(data.server_id);
  if (!node?.isConnected) return;
  const m = data.metrics;
  node.textContent = `CPU ${(m.cpu_percent || 0).toFixed(1)}% · RAM ${bytes(m.memory_used)} / ${bytes(m.memory_total)} · Disco ${bytes(m.disk_used)} / ${bytes(m.disk_total)}`;
}
async function dashboard() {
  const snapshot = await api("/api/overview");
  metricViews.clear();
  const { apps, servers, deployments } = snapshot;
  const latest = new Map(deployments.map((d) => [d.app_id, d]));
  const create =
    session.user.role === "admin"
      ? button("Nova aplicação", () => {
          if (!servers.length) {
            location.assign("/servers");
            return;
          }
          dialog(
            "Nova aplicação",
            appForm(null, servers, (saved) => {
              location.assign(`/apps/${encodeURIComponent(saved.id)}`);
            }),
          );
        })
      : null;
  const cards = apps.map((app) => {
    const deploy = latest.get(app.id);
    const server = servers.find((s) => s.id === app.server_id);
    return card(
      app.name,
      el("div", { class: "row" }, [
        text(app.branch, "code"),
        badge(app.config.stopped ? "parada" : deploy?.status || "sem deploy"),
      ]),
      text(app.repository.replace("https://github.com/", ""), "p", "muted"),
      text(server?.name || "Servidor indisponível", "p", "help"),
      text(
        deploy
          ? `${deploy.sha.slice(0, 8)} · ${time(deploy.queued_at)}`
          : "Envie o primeiro commit para começar.",
        "p",
        "help",
      ),
      actions(
        link("Abrir aplicação →", `/apps/${encodeURIComponent(app.id)}`),
        button(
          "Deploy",
          () => deployDialog(app, app.desired_sha || deploy?.sha || ""),
          "secondary",
        ),
      ),
    );
  });
  content.replaceChildren(
    heading(
      "Visão geral",
      `${apps.length} aplicações · ${servers.filter((s) => s.status === "online").length} servidores online`,
      ...(create ? [create] : []),
    ),
    apps.length
      ? el("div", { class: "grid" }, cards)
      : empty(
          "Nenhuma aplicação. Adicione um servidor e crie sua primeira aplicação.",
        ),
    text("Infraestrutura", "h2", "section"),
    el(
      "div",
      { class: "grid" },
      servers.map((server) =>
        card(server.name, badge(server.status), serverMetrics(server)),
      ),
    ),
  );
}
async function dashboardPage() {
  await dashboard();
  const refresh = refreshQueue(dashboard);
  watch("apps", ["app.updated", "app.deleted"], refresh, refresh);
  watch("deployments", ["deploy.queued", "deploy.status"], refresh, refresh);
  watch("servers", ["server.metrics", "server.offline"], metricEvent);
}
let activeAppTab = "deployments";
let activeApp;
let appDeployments = [];
let appViewGeneration = 0;
let deploymentGeneration = 0;
const appTabs = el("div", { class: "tabs", role: "tablist" });
const appBody = el("div");
let stopLogs = () => {};
async function appPage() {
  const [app, servers] = await Promise.all([
    api(`/api/apps/${encodeURIComponent(appID)}`),
    api("/api/servers"),
  ]);
  activeApp = app;
  const title = heading(
    app.name,
    `${app.repository} · ${app.branch}`,
    button("Novo deploy", () =>
      deployDialog(
        activeApp,
        activeApp.desired_sha || appDeployments[0]?.sha || "",
      ),
    ),
  );
  for (const [key, label] of [
    ["deployments", "Deploys"],
    ["logs", "Logs ao vivo"],
    ["config", "Configurações"],
  ])
    appTabs.append(button(label, () => showTab(key, servers), "secondary"));
  content.replaceChildren(title, appTabs, appBody);
  await showTab(activeAppTab, servers);
  const refresh = refreshQueue(async () => {
    const updated = await api(`/api/apps/${encodeURIComponent(appID)}`);
    activeApp = updated;
    if (activeAppTab === "deployments") await deploymentList();
  });
  watch(
    "deployments",
    ["deploy.queued", "deploy.status"],
    (_, deployment) => {
      if (deployment.app_id === appID) refresh();
    },
    refresh,
  );
  watch(
    "apps",
    ["app.updated", "app.deleted"],
    (kind, app) => {
      if (app.id !== appID) return;
      if (kind === "app.deleted") location.assign("/");
      else refresh();
    },
    refresh,
  );
}
async function showTab(tab, servers) {
  const generation = ++appViewGeneration;
  activeAppTab = tab;
  stopLogs();
  stopLogs = () => {};
  [...appTabs.children].forEach((node, index) =>
    node.setAttribute(
      "aria-selected",
      String(["deployments", "logs", "config"][index] === tab),
    ),
  );
  appBody.replaceChildren(text("Carregando…", "p", "muted"));
  if (tab === "deployments") return deploymentList();
  if (tab === "logs") return logView(`app/${appID}`, "Logs de runtime");
  if (session.user.role !== "admin") {
    appBody.replaceChildren(empty("Configurações restritas ao administrador."));
    return;
  }
  const app = await api(`/api/apps/${encodeURIComponent(appID)}`);
  if (generation !== appViewGeneration || disposed) return;
  const environment = await environmentView(app);
  if (generation !== appViewGeneration || disposed) return;
  activeApp = app;
  appBody.replaceChildren(
    card(
      "Configurações da aplicação",
      appForm(app, servers, async (saved) => {
        activeApp = saved;
      }),
    ),
    environment,
    card(
      "Operação",
      text(
        "Parar e excluir exigem confirmação. Exclua apenas depois de parar e concluir a fila.",
        "p",
        "help",
      ),
      actions(
        ...["start", "stop", "restart"].map((action) =>
          button(
            { start: "Iniciar", stop: "Parar", restart: "Reiniciar" }[action],
            async () => {
              if (action === "stop" && !confirm(`Parar ${app.name}?`)) return;
              await mutate(
                `/api/apps/${encodeURIComponent(appID)}/actions`,
                "POST",
                { action, confirmed: action === "stop" },
              );
              notify("Estado desejado atualizado.");
            },
            action === "stop" ? "danger" : "secondary",
          ),
        ),
        button(
          "Excluir aplicação",
          async () => {
            if (
              !confirm(
                `Excluir ${app.name} e seu histórico? A aplicação precisa estar parada.`,
              )
            )
              return;
            await mutate(`/api/apps/${encodeURIComponent(appID)}`, "DELETE", {
              confirmed: true,
            });
            location.assign("/");
          },
          "danger",
        ),
      ),
    ),
  );
}
async function deploymentList() {
  const generation = ++deploymentGeneration;
  const deployments = await api(
    `/api/apps/${encodeURIComponent(appID)}/deployments`,
  );
  if (
    activeAppTab !== "deployments" ||
    generation !== deploymentGeneration ||
    disposed
  )
    return;
  appDeployments = deployments;
  appBody.replaceChildren(
    appDeployments.length
      ? table(
          [
            "Commit / mensagem",
            "Estado",
            "Início / duração",
            "Etapas",
            "Ações",
          ],
          appDeployments.map((d) => [
            el("div", {}, [
              text(d.sha.slice(0, 12), "code"),
              text(d.message || d.origin, "p", "help"),
              text(d.author, "small"),
            ]),
            badge(d.status),
            `${time(d.queued_at)} · ${d.finished_at && d.started_at ? d.finished_at - d.started_at + " s" : "em andamento"}`,
            Object.entries(d.timings || {})
              .map(([stage, ms]) => `${stage}: ${ms} ms`)
              .join(" · ") || "—",
            actions(
              button(
                "Logs",
                async () => {
                  activeAppTab = "buildlog";
                  await logView(`deploy/${d.id}`, "Log de build", d.id);
                },
                "secondary",
              ),
              ...(["queued", "building", "starting"].includes(d.status)
                ? [
                    button(
                      "Cancelar",
                      async () => {
                        await mutate(
                          `/api/deployments/${encodeURIComponent(d.id)}/cancel`,
                        );
                        notify("Cancelamento solicitado.");
                      },
                      "danger",
                    ),
                  ]
                : []),
              ...(d.status === "success"
                ? [
                    button(
                      "Rollback",
                      () => deployDialog(activeApp, d.sha, "rollback"),
                      "secondary",
                    ),
                  ]
                : []),
            ),
          ]),
        )
      : empty("Nenhum deploy. Inicie um deploy pelo SHA de um commit."),
  );
}
async function environmentView(app) {
  const section = card(
    "Variáveis de ambiente",
    text(
      "Os valores existentes nunca são retornados. Um campo novo substitui somente a chave informada.",
      "p",
      "help",
    ),
  );
  const reload = async () => {
    const vars = await api(`/api/apps/${encodeURIComponent(app.id)}/env`);
    const listing = vars.length
      ? table(
          ["Chave", "Uso", "Ação"],
          vars.map((v) => [
            v.key,
            v.build ? "Secret de build" : "Runtime",
            button(
              "Remover",
              async () => {
                if (!confirm(`Remover a variável ${v.key}?`)) return;
                await mutate(
                  `/api/apps/${encodeURIComponent(app.id)}/env`,
                  "PUT",
                  [{ key: v.key, delete: true }],
                );
                await reload();
              },
              "danger",
            ),
          ]),
        )
      : empty("Nenhuma variável configurada.");
    const existing = $(".env-list", section);
    listing.classList.add("env-list");
    if (existing) existing.replaceWith(listing);
    else section.append(listing);
  };
  section.append(
    form(
      [
        field("Chave", "key", "", "text", {
          required: true,
          pattern: "[A-Za-z_][A-Za-z0-9_]{0,127}",
        }),
        field("Novo valor", "value", "", "password", {
          autocomplete: "new-password",
          maxlength: 65536,
        }),
        field("Disponível somente no build", "build", false, "checkbox"),
      ],
      "Salvar variável",
      async (data, node) => {
        await mutate(`/api/apps/${encodeURIComponent(app.id)}/env`, "PUT", [
          {
            key: String(data.get("key")),
            value: String(data.get("value")),
            build: data.has("build"),
          },
        ]);
        node.reset();
        await reload();
        notify("Variável salva.");
      },
    ),
  );
  await reload();
  return section;
}
async function logView(topic, title, deploymentID) {
  stopLogs();
  let buffer = "",
    paused = false,
    sequence = 0;
  const output = text("", "pre", "log");
  const search = el("input", {
    placeholder: "Buscar nos logs",
    "aria-label": "Buscar nos logs",
  });
  const status = text("Ao vivo", "span", "help");
  const render = () => {
    if (paused) return;
    output.textContent = search.value
      ? buffer
          .split("\n")
          .filter((line) =>
            line.toLowerCase().includes(search.value.toLowerCase()),
          )
          .join("\n")
      : buffer;
    output.scrollTop = output.scrollHeight;
  };
  const append = (line) => {
    buffer = (buffer + line).slice(-262144);
    render();
  };
  search.addEventListener("input", render);
  appBody.replaceChildren(
    card(
      title,
      el("div", { class: "log-tools" }, [
        search,
        button(
          "Pausar / retomar",
          () => {
            paused = !paused;
            status.textContent = paused
              ? "Pausado; buffer limitado a 256 KiB"
              : "Ao vivo";
            render();
          },
          "secondary",
        ),
        button(
          "Baixar",
          () => {
            const url = URL.createObjectURL(
              new Blob([buffer], { type: "text/plain;charset=utf-8" }),
            );
            const anchor = el("a", {
              href: url,
              download: deploymentID
                ? `deploy-${deploymentID}.log`
                : "runtime.log",
            });
            anchor.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          },
          "secondary",
        ),
        status,
      ]),
      output,
    ),
  );
  let pending = "",
    loading = Boolean(deploymentID),
    stopped = false;
  const restore = async () => {
    if (!deploymentID || stopped) return;
    loading = true;
    sequence = 0;
    try {
      const initial = await api(
        `/api/deployments/${encodeURIComponent(deploymentID)}/logs`,
      );
      if (!stopped) {
        // SSE has no durable replay cursor. Preserve live data instead of
        // guessing that identical repeated lines are duplicate events.
        buffer = (initial.text + pending).slice(-262144);
        pending = "";
        loading = false;
        render();
      }
    } catch (error) {
      loading = false;
      if (!stopped) {
        append(pending);
        pending = "";
        report(error);
      }
    }
  };
  const sourceStop = watch(
    topic,
    [deploymentID ? "deploy.log" : "runtime.log"],
    (_, data) => {
      if (data.sequence > 0 && data.sequence <= sequence) return;
      sequence = data.sequence || sequence;
      if (loading) pending = (pending + (data.line || "")).slice(-262144);
      else append(data.line || "");
    },
    async () => {
      sequence = 0;
      await restore();
    },
  );
  stopLogs = () => {
    stopped = true;
    sourceStop();
    buffer = "";
    pending = "";
  };
  if (deploymentID) await restore();
}
async function serversPage() {
  const servers = await api("/api/servers");
  const admin = session.user.role === "admin";
  metricViews.clear();
  const addServer = button("Adicionar servidor", () => {
    const inviteForm = form(
      [
        field("Nome", "name", "", "text", { required: true, maxlength: 80 }),
        field("IPv4 WireGuard", "wireguard_ip", "10.77.0.2", "text", {
          required: true,
        }),
        field("Builds simultâneos", "build_limit", 1, "number", {
          min: 1,
          max: 8,
          required: true,
        }),
        field("Cache (GiB)", "cache", 5, "number", {
          min: 0.0625,
          max: 100,
          step: 0.0625,
          required: true,
        }),
      ],
      "Gerar convite",
      async (data) => {
        const invitation = await mutate("/api/servers/invite", "POST", {
          name: String(data.get("name")),
          wireguard_ip: String(data.get("wireguard_ip")),
          build_limit: Number(data.get("build_limit")),
          cache_bytes: Number(data.get("cache")) * 1073741824,
        });
        secret(
          "Convite do servidor",
          `Servidor: ${invitation.server_id}\nToken: ${invitation.token}\nExpira: ${time(invitation.expires_at)}\nUse o instalador agent com o token lido de forma privada. Consulte o guia de instalação para o release assinado.`,
        );
        await serversPage();
      },
    );
    dialog("Convidar servidor", inviteForm);
  });
  const serverCards = servers.map((server) => {
    const node = card(
      server.name,
      el("div", { class: "row" }, [
        text(server.wireguard_ip, "code"),
        badge(server.status),
      ]),
      text(
        `${server.version || "Versão ainda não informada"} · ${server.ready ? "Pronto" : "Aguardando prontidão"}`,
        "p",
        "help",
      ),
      serverMetrics(server),
    );
    if (admin) {
      node.append(
        form(
          [
            field(
              "Builds simultâneos",
              "build_limit",
              server.build_limit,
              "number",
              { min: 1, max: 8, required: true },
            ),
            field(
              "Cache (GiB)",
              "cache",
              server.cache_bytes / 1073741824,
              "number",
              { min: 0.0625, max: 100, step: 0.0625, required: true },
            ),
          ],
          "Salvar limites",
          async (data) => {
            await mutate(
              `/api/servers/${encodeURIComponent(server.id)}/limits`,
              "PATCH",
              {
                build_limit: Number(data.get("build_limit")),
                cache_bytes: Number(data.get("cache")) * 1073741824,
              },
            );
            notify("Limites atualizados.");
          },
        ),
      );
      const pruneButtons = [
        ["cache", "Limpar cache"],
        ["orphan_images", "Limpar imagens órfãs"],
      ].map(([scope, label]) =>
        button(
          label,
          async () => {
            if (!confirm(`${label} no servidor ${server.name}?`)) return;
            await mutate(
              `/api/servers/${encodeURIComponent(server.id)}/prune`,
              "POST",
              { scope, confirmed: true },
            );
            notify("Limpeza solicitada.");
          },
          "danger",
        ),
      );
      node.append(actions(...pruneButtons));
    }
    return node;
  });
  content.replaceChildren(
    heading(
      "Servidores",
      "Capacidade, saúde e manutenção da infraestrutura.",
      ...(admin ? [addServer] : []),
    ),
    servers.length
      ? el("div", { class: "grid" }, serverCards)
      : empty(
          "Nenhum servidor. Gere um convite para conectar o primeiro agent.",
        ),
  );
  watch("servers", ["server.metrics", "server.offline"], metricEvent);
}
async function securityPage() {
  content.replaceChildren(
    heading(
      "Segurança da conta",
      "Passkeys, segundo fator e códigos de recuperação.",
    ),
    el("div", { class: "grid" }, [
      card(
        "Passkeys",
        text(
          "Adicione uma passkey à sua conta. Requer login nos últimos cinco minutos.",
          "p",
          "help",
        ),
        button("Adicionar passkey", async () => {
          await passkey(true);
          notify("Passkey adicionada.");
        }),
      ),
      card(
        "Autenticação em duas etapas",
        text(
          "Ao ativar ou remover TOTP, todas as sessões e tokens são revogados. Você precisará entrar novamente.",
          "p",
          "help",
        ),
        actions(
          button("Configurar TOTP", async () => {
            const setup = await mutate("/api/auth/totp/begin");
            dialog(
              "Configurar autenticador",
              text(
                "Cadastre a URL no seu autenticador, ou copie o segredo. O código de confirmação só pode ser usado uma vez.",
                "p",
                "help",
              ),
              text(setup.url, "pre", "sensitive"),
              form(
                [
                  field("Código TOTP", "code", "", "text", {
                    required: true,
                    pattern: "[0-9]{6}",
                    autocomplete: "one-time-code",
                  }),
                ],
                "Ativar TOTP",
                async (data) => {
                  await mutate("/api/auth/totp/finish", "POST", {
                    id: setup.id,
                    code: String(data.get("code")),
                  });
                  location.assign("/login");
                },
              ),
            );
          }),
          button(
            "Remover TOTP",
            async () => {
              if (!confirm("Remover TOTP e revogar todas as sessões e tokens?"))
                return;
              await mutate("/api/auth/totp/reset");
              location.assign("/login");
            },
            "danger",
          ),
        ),
      ),
      card(
        "Recuperação",
        text(
          "Gere dez códigos de uso único depois de ativar TOTP. Uma nova geração invalida os anteriores.",
          "p",
          "help",
        ),
        button("Gerar códigos", async () => {
          const result = await mutate("/api/auth/recovery-codes");
          secret("Códigos de recuperação", result.codes.join("\n"));
        }),
      ),
    ]),
  );
}
let settingsGeneration = 0;
let operationsTimer;
async function settingsPage() {
  const generation = ++settingsGeneration;
  clearTimeout(operationsTimer);
  if (session.user.role !== "admin") {
    content.replaceChildren(
      heading("Ajustes", "Administração da plataforma."),
      empty("Ajustes restritos ao administrador."),
    );
    return;
  }
  const [settings, users, tokens, operations, audit] = await Promise.all(
    [
      "/api/settings",
      "/api/users",
      "/api/tokens",
      "/api/operations",
      "/api/audit",
    ].map((path) => api(path)),
  );
  const userCard = card(
    "Usuários",
    table(
      ["Nome", "E-mail", "Papel"],
      users.map((user) => [user.name, user.email, user.role]),
    ),
    form(
      [
        field("Nome", "name", "", "text", { required: true, maxlength: 120 }),
        field("E-mail", "email", "", "email", { required: true }),
        select(
          "Papel",
          "role",
          [
            ["member", "Membro"],
            ["admin", "Administrador"],
          ],
          "member",
        ),
      ],
      "Convidar usuário",
      async (data) => {
        const result = await mutate(
          "/api/users",
          "POST",
          Object.fromEntries(data),
        );
        secret(
          "Convite de usuário",
          `Token: ${result.token}\nExpira: ${time(result.expires_at)}\nAbra /register na origem deste painel e informe o convite.`,
        );
        userCard.querySelector("tbody").append(
          el(
            "tr",
            {},
            [
              data.get("name"),
              String(data.get("email")).toLowerCase(),
              data.get("role"),
            ].map((value) => text(value, "td")),
          ),
        );
      },
    ),
  );
  const scopes = [
    "apps:read",
    "apps:write",
    "deploys:read",
    "deploys:write",
    "servers:read",
    "servers:write",
    "logs:read",
    "users:write",
    "settings:write",
    "audit:read",
  ];
  const tokenTable = () =>
    table(
      ["Nome", "Escopos", "Expira", "Ação"],
      tokens.map((token) => [
        token.name,
        token.scopes.join(", "),
        time(token.expires_at),
        button(
          "Revogar",
          async (buttonNode) => {
            if (!confirm(`Revogar ${token.name}?`)) return;
            await api(`/api/tokens/${encodeURIComponent(token.id)}`, "DELETE");
            const index = tokens.findIndex((item) => item.id === token.id);
            if (index >= 0) tokens.splice(index, 1);
            buttonNode.closest("tr").remove();
            notify("Token revogado.");
          },
          "danger",
        ),
      ]),
    );
  const tokenCard = card(
    "Tokens de API",
    text(
      "Somente o criador vê e revoga seus tokens. A criação exige reautenticação recente.",
      "p",
      "help",
    ),
    tokenTable(),
    form(
      [
        field("Nome do token", "name", "", "text", {
          required: true,
          maxlength: 80,
        }),
        field("Validade (horas)", "ttl_hours", 24, "number", {
          min: 1,
          max: 720,
          required: true,
        }),
        ...scopes.map((scope) => field(scope, "scope", false, "checkbox")),
      ],
      "Criar token",
      async (data, node) => {
        const selected = [
          ...node.querySelectorAll("input[name=scope]:checked"),
        ].map((input) => input.dataset.scope);
        if (!selected.length) throw new Error("Selecione ao menos um escopo.");
        const result = await mutate("/api/tokens", "POST", {
          name: String(data.get("name")),
          ttl_hours: Number(data.get("ttl_hours")),
          scopes: selected,
        });
        const { token, ...metadata } = result;
        tokens.unshift(metadata);
        tokenCard.querySelector(".table-wrap").replaceWith(tokenTable());
        node.reset();
        secret("Token de API", token);
      },
    ),
  );
  [...tokenCard.querySelectorAll("input[name=scope]")].forEach(
    (input, index) => {
      input.dataset.scope = scopes[index];
    },
  );
  const githubCard = card(
    "GitHub App",
    text(
      "Conecte uma GitHub App para repositórios privados, webhooks e check runs. A troca usa state de uso único.",
      "p",
      "help",
    ),
    button("Conectar GitHub", async () => {
      const result = await mutate("/api/github/manifest");
      const node = el(
        "form",
        { method: "POST", action: safeGitHub(result.action) },
        [
          el("input", {
            type: "hidden",
            name: "manifest",
            value: JSON.stringify(result.manifest),
          }),
        ],
      );
      document.body.append(node);
      node.submit();
    }),
    text(
      `Ajustes configurados: ${settings.configured.join(", ") || "nenhum"}`,
      "p",
      "help",
    ),
    form(
      [
        select(
          "Ajuste",
          "key",
          [
            ...[
              "github.app_id",
              "github.private_key",
              "github.webhook_secret",
              "github.client_id",
              "github.client_secret",
              "backup.s3",
            ].map((key) => [key, key]),
          ],
          "github.app_id",
        ),
        field(
          "Novo valor (S3: JSON conforme documentação)",
          "value",
          "",
          "textarea",
          { required: true, autocomplete: "off", maxlength: 32768 },
        ),
      ],
      "Salvar ajuste",
      async (data, node) => {
        await mutate(
          `/api/settings/${encodeURIComponent(String(data.get("key")))}`,
          "PUT",
          { value: String(data.get("value")) },
        );
        node.reset();
        notify("Ajuste cifrado e salvo.");
      },
    ),
  );
  const operationTable = el("div");
  let operationsRequest = null;
  const drawOperations = (rows) => {
    if (generation !== settingsGeneration || disposed) return;
    clearTimeout(operationsTimer);
    operationTable.replaceChildren(
      table(
        ["Tipo", "Destino", "Versão", "Estado", "Início", "Ação"],
        rows.map((operation) => [
          operation.kind,
          operation.target,
          operation.version || "—",
          el("div", {}, [
            badge(operation.status),
            text(operation.error_code || "", "small"),
          ]),
          time(operation.created_at),
          operation.status === "queued" && operation.batch
            ? button(
                "Cancelar lote",
                async () => {
                  if (
                    !confirm(
                      "Cancelar as etapas ainda não iniciadas deste lote?",
                    )
                  )
                    return;
                  await mutate(
                    `/api/operations/${encodeURIComponent(operation.batch)}/cancel`,
                  );
                  await refreshOperations();
                },
                "danger",
              )
            : text("—", "span"),
        ]),
      ),
    );
    if (rows.some((row) => ["queued", "waiting"].includes(row.status))) {
      operationsTimer = setTimeout(
        () => refreshOperations().catch(report),
        3000,
      );
    }
  };
  const refreshOperations = () => {
    if (operationsRequest) return operationsRequest;
    operationsRequest = api("/api/operations")
      .then(drawOperations)
      .finally(() => {
        operationsRequest = null;
      });
    return operationsRequest;
  };
  const operationCard = card(
    "Backup e atualização",
    text(
      "Operações exigem uma sessão recente. Reautentique em Entrar se necessário. Backups não expõem arquivos nem chaves ao navegador. Atualizações precisam de releases assinados.",
      "p",
      "help",
    ),
    actions(
      button("Criar backup", async () => {
        await mutate("/api/operations/backup");
        notify("Backup enfileirado.");
        await refreshOperations();
      }),
      button(
        "Atualizar plataforma",
        () =>
          dialog(
            "Atualização da plataforma",
            form(
              [
                field("Versão assinada", "version", "", "text", {
                  required: true,
                  pattern: "v[0-9]+\\.[0-9]+\\.[0-9]+",
                }),
              ],
              "Enfileirar atualização",
              async (data) => {
                if (
                  !confirm(
                    "Atualizar os agents e depois o painel para a versão informada?",
                  )
                )
                  return;
                await mutate("/api/operations/update", "POST", {
                  version: String(data.get("version")),
                });
                modal.close();
                notify("Atualização enfileirada.");
                await refreshOperations();
              },
            ),
          ),
        "secondary",
      ),
      button("Atualizar operações", refreshOperations, "secondary"),
      link("Reautenticar", "/login"),
    ),
    operationTable,
  );
  drawOperations(operations);
  content.replaceChildren(
    heading("Ajustes", "Integrações, acesso e operações da plataforma."),
    el("div", { class: "grid" }, [
      userCard,
      tokenCard,
      githubCard,
      operationCard,
    ]),
    card(
      "Auditoria",
      table(
        ["Quando", "Ator", "Ação", "Alvo", "IP"],
        audit.map((entry) => [
          time(entry.created_at),
          entry.user_id,
          entry.action,
          entry.target,
          entry.ip,
        ]),
      ),
    ),
  );
}
function setupShell() {
  const nav = page === "app" ? "dashboard" : page;
  document
    .querySelector(`[data-nav="${nav}"]`)
    ?.setAttribute("aria-current", "page");
  $("#breadcrumb").textContent =
    {
      dashboard: "Visão geral",
      app: "Aplicação",
      servers: "Servidores",
      settings: "Ajustes",
      security: "Segurança",
      login: "Acesso",
      register: "Primeiro acesso",
    }[page] || "Painel";
  try {
    document.documentElement.dataset.theme =
      localStorage.getItem("nelcota-theme") || "dark";
  } catch {
    /* Theme persistence is optional. */
  }
  $("#theme").addEventListener("click", () => {
    const next =
      document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("nelcota-theme", next);
    } catch {
      /* Private browsing. */
    }
  });
  const commands = () =>
    dialog(
      "Navegar",
      el(
        "div",
        { class: "grid" },
        [
          ["Visão geral", "/"],
          ["Servidores", "/servers"],
          ["Ajustes", "/settings"],
          ["Segurança", "/security"],
        ].map(([title, url]) => link(title, url)),
      ),
    );
  $("#commands").addEventListener("click", commands);
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      commands();
    }
  });
  $("#logout").addEventListener("click", async () => {
    try {
      await api("/api/auth/logout", "POST");
      location.assign("/login");
    } catch (error) {
      report(error);
    }
  });
  window.addEventListener("pagehide", () => {
    disposed = true;
    for (const source of streams.values()) source.close();
    streams.clear();
    clearTimeout(noticeTimer);
    clearTimeout(operationsTimer);
    stopLogs();
    $("#modal-content").replaceChildren();
    document
      .querySelectorAll('input[type="password"], textarea[name="value"]')
      .forEach((input) => {
        input.value = "";
      });
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) location.reload();
  });
}
async function boot() {
  setupShell();
  try {
    session = await api("/api/session");
  } catch (error) {
    if (error.status !== 401) throw error;
  }
  if (session) {
    $("#identity").textContent = session.user.name;
    $("#logout").hidden = false;
  }
  if (page === "login" || page === "register") {
    loginView(page === "register");
    return;
  }
  if (!session) {
    location.assign("/login");
    return;
  }
  await (
    {
      dashboard: dashboardPage,
      app: appPage,
      servers: serversPage,
      settings: settingsPage,
      security: securityPage,
    }[page] || dashboardPage
  )();
  if (!streams.size) $("#connection").textContent = "Sessão autenticada";
}
boot().catch((error) => {
  content.replaceChildren(
    heading(
      "Não foi possível carregar o painel",
      "Confira sua sessão ou tente novamente.",
    ),
    text(error.message, "p", "error"),
    button("Tentar novamente", () => location.reload()),
  );
});
