import type { ProcessResult } from "@/process";

/** How a database container starts: environment values and the command after the image. */
type DatabaseContainerSettings = {
  readonly environment: Readonly<Record<string, string>>;
  /** Empty to keep the image's own command. */
  readonly command: readonly string[];
};

/** Commands that dump a database to a file inside its container and load it back. */
type DatabaseBackupCommands = {
  readonly dump: (path: string) => readonly string[];
  readonly restore: (path: string) => readonly string[];
};

/** What differs between the database servers the platform runs. */
export type DatabaseEngine = {
  /** Name of the engine as people know it, for messages. */
  readonly label: string;
  /** Pinned image, so a redeploy never jumps to another major version. */
  readonly imageTag: string;
  /** Port the server listens on inside the platform network. */
  readonly port: number;
  /** Directory inside the container kept in the data volume. */
  readonly dataPath: string;
  /** User applications connect as; null when the engine has no users. */
  readonly user: string | null;
  /** Database applications connect to; null when the engine has no named databases. */
  readonly databaseName: string | null;
  readonly containerSettings: (password: string) => DatabaseContainerSettings;
  readonly connectionUrl: (host: string, password: string) => string;
  /** Command run inside the container to tell whether the server accepts connections. */
  readonly readinessCommand: readonly string[];
  readonly isReady: (result: ProcessResult) => boolean;
  /** Null when the platform does not back the engine up. */
  readonly backup: DatabaseBackupCommands | null;
};
