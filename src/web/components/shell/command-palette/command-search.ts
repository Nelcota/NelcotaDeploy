import type { LucideIcon } from "lucide-react";

/** One entry of the command palette. */
export type Command = {
  readonly id: string;
  readonly group: "Projetos" | "Páginas";
  readonly label: string;
  readonly hint: string;
  readonly icon: LucideIcon;
  readonly run: () => Promise<void>;
};

function normalize(text: string): string {
  return text.normalize("NFD").replaceAll(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Keeps the commands whose label or hint contains the query, ignoring case and accents.
 *
 * @param commands - Every available command, in display order.
 * @param query - Text typed by the user; blank keeps every command.
 * @returns The matching commands, in the same order.
 */
export function filterCommands(commands: readonly Command[], query: string): Command[] {
  const needle = normalize(query.trim());
  if (needle === "") {
    return [...commands];
  }
  return commands.filter((command) =>
    normalize(`${command.label} ${command.hint}`).includes(needle),
  );
}

/**
 * Moves the selection for an arrow key, staying inside the list.
 *
 * @param key - Key pressed; only "ArrowDown" and "ArrowUp" move the selection.
 * @param index - Currently selected position.
 * @param count - Number of results; zero keeps the selection at the top.
 * @returns The new selected position.
 */
export function moveSelection(key: string, index: number, count: number): number {
  if (key === "ArrowDown") {
    return Math.max(Math.min(index + 1, count - 1), 0);
  }
  if (key === "ArrowUp") {
    return Math.max(index - 1, 0);
  }
  return index;
}
