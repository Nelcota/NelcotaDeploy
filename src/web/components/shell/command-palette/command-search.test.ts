import { describe, expect, test } from "bun:test";

import { BoxesIcon } from "lucide-react";

import {
  type Command,
  filterCommands,
  moveSelection,
} from "@/web/components/shell/command-palette/command-search";

function command(label: string, hint: string | null, group: Command["group"] = "Páginas"): Command {
  return { id: label, group, label, hint, icon: BoxesIcon, run: async () => {} };
}

describe("filterCommands", () => {
  test("keeps every command for a blank query", () => {
    const commands = [command("Painel", "Página"), command("Deploys", "Página")];

    const result = filterCommands(commands, "   ");

    expect(result.map((item) => item.label)).toEqual(["Painel", "Deploys"]);
  });

  test("matches the hint ignoring case and accents", () => {
    const commands = [command("Usuários", "Administração"), command("Painel", "Página")];

    const result = filterCommands(commands, "ADMINISTRACAO");

    expect(result.map((item) => item.label)).toEqual(["Usuários"]);
  });

  test("matches the group name ignoring case and accents", () => {
    const commands = [command("Usuários", null, "Administração"), command("Painel", null)];

    const result = filterCommands(commands, "administracao");

    expect(result.map((item) => item.label)).toEqual(["Usuários"]);
  });

  test("matches the label when the command has no hint", () => {
    const commands = [command("Novo projeto", null), command("Painel", null)];

    const result = filterCommands(commands, "novo");

    expect(result.map((item) => item.label)).toEqual(["Novo projeto"]);
  });

  test("returns nothing when no command matches", () => {
    const commands = [command("Painel", "Página")];

    const result = filterCommands(commands, "xyz");

    expect(result).toEqual([]);
  });

  test("matches words across the project hint and destination in any order", () => {
    const commands = [
      command("Logs da aplicação", "API de pagamentos"),
      command("Logs do build", "Site institucional"),
    ];

    expect(filterCommands(commands, "pagamentos logs").map((item) => item.label)).toEqual([
      "Logs da aplicação",
    ]);
    expect(filterCommands(commands, " LOGS   pagamentos ").map((item) => item.label)).toEqual([
      "Logs da aplicação",
    ]);
  });

  test("finds common aliases without displaying them as labels", () => {
    const commands = [
      {
        ...command("Build", "API de pagamentos", "Neste projeto"),
        keywords: "dockerfile compilação",
      },
    ];

    expect(filterCommands(commands, "api dockerfile")).toEqual(commands);
    expect(filterCommands(commands, "compilacao")).toEqual(commands);
    expect(filterCommands(commands, "dockerfile ausente")).toEqual([]);
  });
});

describe("moveSelection", () => {
  test("moves down one position", () => {
    expect(moveSelection("ArrowDown", 0, 3)).toBe(1);
  });

  test("stops at the last result when moving down", () => {
    expect(moveSelection("ArrowDown", 2, 3)).toBe(2);
  });

  test("stays at the top when there are no results", () => {
    expect(moveSelection("ArrowDown", 0, 0)).toBe(0);
  });

  test("stops at the first result when moving up", () => {
    expect(moveSelection("ArrowUp", 0, 3)).toBe(0);
  });

  test("ignores other keys", () => {
    expect(moveSelection("Enter", 1, 3)).toBe(1);
  });
});
