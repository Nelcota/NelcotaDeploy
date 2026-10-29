import { describe, expect, test } from "bun:test";

import { BoxesIcon } from "lucide-react";

import {
  type Command,
  filterCommands,
  moveSelection,
} from "@/web/components/shell/command-palette/command-search";

function command(label: string, hint: string): Command {
  return { id: label, group: "Páginas", label, hint, icon: BoxesIcon, run: async () => {} };
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

  test("returns nothing when no command matches", () => {
    const commands = [command("Painel", "Página")];

    const result = filterCommands(commands, "xyz");

    expect(result).toEqual([]);
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
