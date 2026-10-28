/** Thrown when a command line has unbalanced quotes or a dangling escape. */
export class CommandLineParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandLineParseError";
  }
}

type QuoteState = "none" | "single" | "double";

/** Splits text into words one character at a time, tracking quotes and escapes. */
class Tokenizer {
  readonly args: string[] = [];
  #current = "";
  #hasCurrent = false;
  #quote: QuoteState = "none";
  #escaping = false;

  consume(character: string): void {
    if (this.#escaping) {
      this.#append(character);
      this.#escaping = false;
      return;
    }
    if (this.#quote === "single") {
      this.#consumeQuoted(character, "'");
      return;
    }
    if (character === "\\") {
      this.#escaping = true;
      this.#hasCurrent = true;
      return;
    }
    if (this.#quote === "double") {
      this.#consumeQuoted(character, '"');
      return;
    }
    this.#consumeUnquoted(character);
  }

  finish(): string[] {
    if (this.#escaping) {
      throw new CommandLineParseError("Command line ends with a dangling escape character");
    }
    if (this.#quote !== "none") {
      throw new CommandLineParseError(`Command line has an unterminated ${this.#quote} quote`);
    }
    this.#endWord();
    return this.args;
  }

  #consumeQuoted(character: string, closingQuote: string): void {
    if (character === closingQuote) {
      this.#quote = "none";
      return;
    }
    this.#append(character);
  }

  #consumeUnquoted(character: string): void {
    if (character === "'" || character === '"') {
      this.#quote = character === "'" ? "single" : "double";
      this.#hasCurrent = true;
      return;
    }
    if (/\s/.test(character)) {
      this.#endWord();
      return;
    }
    this.#append(character);
  }

  #append(character: string): void {
    this.#current += character;
    this.#hasCurrent = true;
  }

  #endWord(): void {
    if (this.#hasCurrent) {
      this.args.push(this.#current);
    }
    this.#current = "";
    this.#hasCurrent = false;
  }
}

/**
 * Splits a command line into arguments the way a POSIX shell tokenizes words,
 * without any expansion: no variables, globs, pipes, redirects or substitutions.
 *
 * @remarks
 * The result runs as an argument vector, so characters such as `|` or `;` are plain text.
 *
 * @param commandLine - Text such as `bun run migrate --force "two words"`.
 * @returns The argument vector.
 * @throws {CommandLineParseError} When a quote is not closed or the line ends with `\`.
 *
 * @example
 * parseCommandLine(`node -e 'console.log(1)'`); // ["node", "-e", "console.log(1)"]
 */
export function parseCommandLine(commandLine: string): string[] {
  const tokenizer = new Tokenizer();
  for (const character of commandLine) {
    tokenizer.consume(character);
  }
  return tokenizer.finish();
}

/**
 * Formats an argument vector back into a command line that `parseCommandLine` reads identically.
 *
 * @param args - Argument vector.
 * @returns A single-line, display-friendly command.
 */
export function formatCommandLine(args: readonly string[]): string {
  return args
    .map((arg) => {
      if (arg !== "" && /^[A-Za-z0-9_@%+=:,./-]+$/.test(arg)) {
        return arg;
      }
      return `'${arg.replaceAll("'", `'\\''`)}'`;
    })
    .join(" ");
}
