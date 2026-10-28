/** Output stream a line came from. */
export type OutputStream = "stdout" | "stderr";

export type RunProcessOptions = {
  /** Working directory for the child process. */
  readonly cwd?: string;
  /** Extra environment variables, added to a minimal inherited set (PATH, HOME, ...). */
  readonly env?: Readonly<Record<string, string>>;
  /** Kills the process after this many milliseconds. */
  readonly timeoutInMs: number;
  /** Kills the process when aborted. */
  readonly signal?: AbortSignal;
  /** Called for every complete output line, in order per stream. */
  readonly onLine?: (line: string, stream: OutputStream) => void;
  /** Bytes kept in `stdout`/`stderr` of the result; extra output is only streamed. */
  readonly maxCapturedBytes?: number;
};

export type ProcessResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly aborted: boolean;
};

const DEFAULT_MAX_CAPTURED_BYTES = 1_048_576;
/** Variables a child process may inherit. Platform secrets are deliberately not in this list. */
const INHERITED_VARIABLES = [
  "PATH",
  "HOME",
  "LANG",
  "TMPDIR",
  "DOCKER_HOST",
  "DOCKER_CONFIG",
  "DOCKER_CONTEXT",
  "DOCKER_CERT_PATH",
  "DOCKER_TLS_VERIFY",
  "XDG_RUNTIME_DIR",
];

/**
 * Builds the environment for a child process from an allow-list plus explicit additions.
 *
 * @param extra - Variables the command needs.
 * @returns The environment object for `Bun.spawn`.
 */
export function buildChildEnvironment(
  extra: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const name of INHERITED_VARIABLES) {
    const value = process.env[name];
    if (value != null) {
      environment[name] = value;
    }
  }
  return { ...environment, ...extra };
}

async function readLines(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<void> {
  const decoder = new TextDecoder();
  let pending = "";
  for await (const chunk of stream) {
    pending += decoder.decode(chunk, { stream: true });
    const lines = pending.split(/\r?\n|\r/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      onLine(line);
    }
  }
  pending += decoder.decode();
  if (pending !== "") {
    onLine(pending);
  }
}

class CapturedOutput {
  readonly #limit: number;
  #text = "";
  #truncated = false;

  constructor(limit: number) {
    this.#limit = limit;
  }

  append(line: string): void {
    if (this.#truncated) {
      return;
    }
    if (this.#text.length + line.length + 1 > this.#limit) {
      this.#truncated = true;
      return;
    }
    this.#text += `${line}\n`;
  }

  get text(): string {
    return this.#text;
  }
}

/**
 * Runs a command without a shell. Arguments are passed as a vector, so no input is ever
 * interpreted by a shell.
 *
 * @param command - Executable followed by its arguments.
 * @param options - Working directory, environment, timeout and output callbacks.
 * @returns Exit code and captured output. A killed process reports a non-zero exit code.
 */
export async function runProcess(
  command: readonly string[],
  options: RunProcessOptions,
): Promise<ProcessResult> {
  const startedAt = performance.now();
  const child = Bun.spawn([...command], {
    cwd: options.cwd ?? process.cwd(),
    env: buildChildEnvironment(options.env),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: options.timeoutInMs,
    killSignal: "SIGKILL",
    ...(options.signal == null ? {} : { signal: options.signal }),
  });
  const limit = options.maxCapturedBytes ?? DEFAULT_MAX_CAPTURED_BYTES;
  const stdout = new CapturedOutput(limit);
  const stderr = new CapturedOutput(limit);
  await Promise.all([
    readLines(child.stdout, (line) => {
      stdout.append(line);
      options.onLine?.(line, "stdout");
    }),
    readLines(child.stderr, (line) => {
      stderr.append(line);
      options.onLine?.(line, "stderr");
    }),
  ]);
  const exitCode = await child.exited;
  const aborted = options.signal?.aborted === true;
  const killed = child.signalCode != null;
  const timedOut =
    killed && aborted === false && performance.now() - startedAt >= options.timeoutInMs;
  return {
    exitCode: killed && exitCode === 0 ? 1 : exitCode,
    stdout: stdout.text,
    stderr: stderr.text,
    timedOut,
    aborted,
  };
}
