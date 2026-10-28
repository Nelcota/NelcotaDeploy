import type { Database } from "@/db";
import { appendDeploymentLogs, type DeploymentLogEntry } from "@/logs";
import { classifyLogLevel, type LogLevel } from "@/shared/log-level";

const FLUSH_INTERVAL_IN_MS = 250;
const MAX_BUFFERED_LINES = 200;

/**
 * Buffers deployment log lines and writes them in small batches, redacting secrets first.
 *
 * @remarks
 * Batching keeps SQLite writes cheap during noisy builds while the panel still sees
 * output within a fraction of a second.
 */
export class DeploymentLogWriter implements Disposable {
  readonly #database: Database;
  readonly #deploymentId: string;
  readonly #timer: ReturnType<typeof setInterval>;
  #redact: (text: string) => string = (text) => text;
  #buffer: DeploymentLogEntry[] = [];

  constructor(database: Database, deploymentId: string) {
    this.#database = database;
    this.#deploymentId = deploymentId;
    this.#timer = setInterval(() => this.flush(), FLUSH_INTERVAL_IN_MS);
  }

  /** Sets the function that removes secret values from every following line. */
  useRedactor(redact: (text: string) => string): void {
    this.#redact = redact;
  }

  /** Writes a platform message, such as "Cloning repository". */
  system(message: string, level: LogLevel = "info"): void {
    this.#push({ stream: "system", level, message });
  }

  /** Writes one line of a command's output. */
  output(line: string, stream: "stdout" | "stderr"): void {
    this.#push({ stream, level: classifyLogLevel(line), message: line });
  }

  #push(entry: DeploymentLogEntry): void {
    this.#buffer.push({ ...entry, message: this.#redact(entry.message) });
    if (this.#buffer.length >= MAX_BUFFERED_LINES) {
      this.flush();
    }
  }

  /** Writes buffered lines now. */
  flush(): void {
    if (this.#buffer.length === 0) {
      return;
    }
    const entries = this.#buffer;
    this.#buffer = [];
    appendDeploymentLogs(this.#database, this.#deploymentId, entries);
  }

  [Symbol.dispose](): void {
    clearInterval(this.#timer);
    this.flush();
  }
}
