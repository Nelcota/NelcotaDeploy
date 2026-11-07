import { expect, mock, test } from "bun:test";

import { filterCommands } from "./command-search";
import { createProjectCommands } from "./project-commands";

const navigate = () => Promise.resolve();

test.each([
  ["build", "Construção da imagem"],
  ["previews", "Ambientes de teste por pull request"],
  ["tasks", "Tarefas da aplicação"],
  ["volumes", "Armazenamento persistente"],
  ["identidade", "Nome e identificador do projeto"],
  ["execução", "Porta e verificação de saúde"],
  ["métricas", "Uso de recursos da aplicação"],
])("keeps the former term %s searchable under the descriptive name %s", (query, label) => {
  const commands = createProjectCommands({
    navigate,
    permissions: [],
    context: { projectId: "project-a" },
  });

  const matches = filterCommands(commands, query);

  expect(matches.some((command) => command.label === label)).toBe(true);
});

test.each([undefined, "", " "])("does not invent a project context for %p", (projectId) => {
  expect(createProjectCommands({ navigate, permissions: [], context: { projectId } })).toEqual([]);
});

test("offers every readable project page without restricted settings or imports", () => {
  const commands = createProjectCommands({
    navigate,
    permissions: [],
    context: { projectId: "project-a" },
  });
  const labels = new Set(commands.map((item) => item.label));

  for (const label of [
    "Ambientes de teste por pull request",
    "Registros DNS dos domínios",
    "Logs da aplicação",
    "Bancos de dados",
    "Tarefas da aplicação",
    "Construção da imagem",
    "Armazenamento persistente",
  ]) {
    expect(labels.has(label)).toBe(true);
  }
  for (const label of [
    "Trocar servidor",
    "Excluir projeto",
    "Importar variáveis de arquivo .env",
    "Importar variáveis do repositório",
  ]) {
    expect(labels.has(label)).toBe(false);
  }
});

test("shows import workflows to editors but not server moves or project deletion", () => {
  const commands = createProjectCommands({
    navigate,
    permissions: ["environment:write"],
    context: { projectId: "project-a" },
  });
  const labels = new Set(commands.map((item) => item.label));

  expect(labels.has("Importar variáveis de arquivo .env")).toBe(true);
  expect(labels.has("Importar variáveis do repositório")).toBe(true);
  expect(labels.has("Trocar servidor")).toBe(false);
  expect(labels.has("Excluir projeto")).toBe(false);
});

test("keeps server and deletion permissions independent", () => {
  const commands = createProjectCommands({
    navigate,
    permissions: ["settings:write"],
    context: { projectId: "project-a" },
  });
  const labels = new Set(commands.map((item) => item.label));

  expect(labels.has("Trocar servidor")).toBe(true);
  expect(labels.has("Excluir projeto")).toBe(false);
});

test("can find a build page by Dockerfile and the project's name", async () => {
  const go = mock(() => Promise.resolve());
  const commands = createProjectCommands({
    navigate: go,
    permissions: [],
    projectName: "API de pagamentos",
    context: { projectId: "project-a" },
  });
  const selected = filterCommands(commands, "pagamentos dockerfile").at(0);
  expect(selected?.label).toBe("Construção da imagem");
  if (selected == null) {
    throw new Error("Build destination is missing");
  }

  await selected.run();

  expect(go).toHaveBeenCalledWith({
    to: "/projects/$projectId/settings/build",
    params: { projectId: "project-a" },
  });
});

test("links a resource to the currently selected project and deployment", async () => {
  const go = mock(() => Promise.resolve());
  const commands = createProjectCommands({
    navigate: go,
    permissions: [],
    context: { projectId: "project-b", deploymentId: "deploy-b" },
  });
  const selected = commands.find((item) => item.label === "Logs da construção da imagem");
  if (selected == null) {
    throw new Error("Build log destination is missing");
  }

  await selected.run();

  expect(go).toHaveBeenCalledWith({
    to: "/projects/$projectId/deployments/$deploymentId/logs",
    params: { projectId: "project-b", deploymentId: "deploy-b" },
  });
});

test("exposes restoration only with data deletion permission and a database context", () => {
  const context = { projectId: "project-a", databaseId: "database-a" };
  const readOnly = createProjectCommands({ navigate, permissions: [], context });
  const administrator = createProjectCommands({
    navigate,
    permissions: ["project:delete"],
    context,
  });
  const withoutDatabase = createProjectCommands({
    navigate,
    permissions: ["project:delete"],
    context: { projectId: "project-a" },
  });

  expect(readOnly.some((item) => item.label === "Backups do banco")).toBe(true);
  expect(readOnly.some((item) => item.label === "Restaurar banco")).toBe(false);
  expect(administrator.some((item) => item.label === "Restaurar banco")).toBe(true);
  expect(withoutDatabase.some((item) => item.label === "Restaurar banco")).toBe(false);
});

test("ignores blank resource identifiers and keeps command identifiers unique", () => {
  const commands = createProjectCommands({
    navigate,
    permissions: ["project:delete", "environment:write"],
    context: { projectId: "project-a", databaseId: " ", deploymentId: "", taskId: " " },
  });

  expect(commands.some((item) => item.id.startsWith("current-"))).toBe(false);
  expect(new Set(commands.map((item) => item.id)).size).toBe(commands.length);
});

test("prioritizes the current resource over a generic project destination", () => {
  const commands = createProjectCommands({
    navigate,
    permissions: ["project:delete"],
    context: { projectId: "project-a", databaseId: "database-a" },
  });

  expect(filterCommands(commands, "backups").at(0)?.label).toBe("Backups do banco");
  expect(filterCommands(commands, "restaurar banco").at(0)?.label).toBe("Restaurar banco");
});
