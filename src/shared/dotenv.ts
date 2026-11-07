import { environmentVariableInputSchema } from "./schemas/environment-variable.schema";

/** One `KEY=value` pair read from pasted `.env` text. */
export type DotenvEntry = { readonly key: string; readonly value: string };

/** A line that could not be imported, with its 1-based line number. */
export type DotenvProblem = {
  readonly line: number;
  readonly text: string;
  readonly reason: string;
};

const EXPORT_PREFIX = /^export\s+/;

function unquote(value: string): string {
  const quoted = /^(["'`])([\s\S]*)\1[ \t]*(?:#.*)?$/.exec(value);
  return quoted?.[2] ?? value.replace(/#.*$/, "").trimEnd();
}

/** Locates the end of a quoted assignment so diagnostics never treat its body as new variables. */
function assignmentEnd(lines: readonly string[], start: number, value: string): number | null {
  const quote = value.at(0);
  if (quote !== '"' && quote !== "'" && quote !== "`") {
    return start;
  }
  const closing = new RegExp(`(?<!\\\\)${RegExp.escape(quote)}[ \\t]*(?:#.*)?$`);
  for (let index = start; index < lines.length; index += 1) {
    if (closing.test(index === start ? value.slice(1) : (lines[index] ?? ""))) {
      return index;
    }
  }
  return null;
}

/**
 * Parses pasted `.env` text. Blank lines and `#` comments are skipped; `export ` prefixes and
 * surrounding quotes are removed. When a key repeats, the last value wins, as in shells.
 *
 * @param text - Contents of a `.env` file.
 * @returns Valid entries in order of first appearance and the lines that were rejected.
 */
export function parseDotenv(text: string): { entries: DotenvEntry[]; problems: DotenvProblem[] } {
  const values = new Map<string, string>();
  const problems: DotenvProblem[] = [];
  const lines = text.replaceAll(/\r\n?/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const assignment = line.replace(EXPORT_PREFIX, "");
    const separator = assignment.indexOf("=");
    if (separator <= 0) {
      problems.push({ line: index + 1, text: line, reason: "Falta o sinal de igual (NOME=valor)" });
      continue;
    }
    const key = assignment.slice(0, separator).trim();
    const rawValue = assignment.slice(separator + 1).trimStart();
    const end = assignmentEnd(lines, index, rawValue);
    if (end == null) {
      problems.push({ line: index + 1, text: line, reason: "Valor entre aspas não foi fechado" });
      break;
    }
    const statement = lines.slice(index, end + 1).join("\n");
    const lineNumber = index + 1;
    index = end;
    if (environmentVariableInputSchema.shape.key.safeParse(key).success === false) {
      problems.push({ line: lineNumber, text: line, reason: `Nome inválido: ${key}` });
      continue;
    }
    const value = unquote(statement.slice(statement.indexOf("=") + 1).trim());
    values.set(
      key,
      rawValue.startsWith('"') ? value.replaceAll("\\n", "\n").replaceAll('\\"', '"') : value,
    );
  }
  return { entries: [...values].map(([key, value]) => ({ key, value })), problems };
}

/**
 * Turns typed text into a valid variable name: uppercase, spaces and dashes become `_`, other
 * characters are dropped.
 *
 * @param text - What the user typed.
 * @returns The normalized name.
 */
export function normalizeVariableKey(text: string): string {
  return text
    .toUpperCase()
    .replaceAll(/[\s-]+/g, "_")
    .replaceAll(/[^A-Z0-9_]/g, "");
}
