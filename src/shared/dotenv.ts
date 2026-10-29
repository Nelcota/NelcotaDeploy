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
  const quote = value.at(0);
  if ((quote === '"' || quote === "'") && value.length >= 2 && value.at(-1) === quote) {
    const inner = value.slice(1, -1);
    return quote === '"' ? inner.replaceAll("\\n", "\n").replaceAll('\\"', '"') : inner;
  }
  // An unquoted value ends at an inline comment preceded by whitespace.
  return value.replace(/\s+#.*$/, "");
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
  text.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      return;
    }
    const assignment = line.replace(EXPORT_PREFIX, "");
    const separator = assignment.indexOf("=");
    if (separator <= 0) {
      problems.push({ line: index + 1, text: line, reason: "Falta o sinal de igual (NOME=valor)" });
      return;
    }
    const key = assignment.slice(0, separator).trim();
    if (environmentVariableInputSchema.shape.key.safeParse(key).success === false) {
      problems.push({ line: index + 1, text: line, reason: `Nome inválido: ${key}` });
      return;
    }
    values.set(key, unquote(assignment.slice(separator + 1).trim()));
  });
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
