import type { DatabaseEngineName } from "@/shared/schemas/database.schema";

/** Names of the engines as people know them. */
export const ENGINE_LABELS: Readonly<Record<DatabaseEngineName, string>> = {
  postgres: "PostgreSQL",
  redis: "Redis",
};

/** Variable each engine's URL goes to unless the user picks another, as most libraries expect. */
export const DEFAULT_ENVIRONMENT_KEYS: Readonly<Record<DatabaseEngineName, string>> = {
  postgres: "DATABASE_URL",
  redis: "REDIS_URL",
};

/** Fields of a database that decide what its row shows and allows. */
type DatabaseFields = {
  readonly status: "provisioning" | "running" | "failed" | "restoring";
  readonly errorMessage: string | null;
  readonly deletionRequestedAt: string | null;
};

/** What a database row shows: a tag, a note after a failure and the actions it offers. */
export type DatabaseState = {
  readonly label: string;
  readonly tone: "neutral" | "warning" | "success";
  readonly failureNote: string | null;
  readonly canRetry: boolean;
  readonly canDelete: boolean;
};

/**
 * Describes a database for its row in the project's databases tab.
 *
 * @param database - Its status, the reason of its last failure and whether it is being deleted.
 * @returns The tag, an explanation of the last failure and the allowed actions.
 */
export function databaseState(database: DatabaseFields): DatabaseState {
  if (database.deletionRequestedAt != null) {
    return {
      label: "Excluindo…",
      tone: "warning",
      failureNote: null,
      canRetry: false,
      canDelete: false,
    };
  }
  // The stored reason is for the logs; people get a message they can act on.
  switch (database.status) {
    case "provisioning":
      return {
        label: "Iniciando…",
        tone: "neutral",
        failureNote: null,
        canRetry: false,
        canDelete: true,
      };
    case "restoring":
      return {
        label: "Restaurando…",
        tone: "warning",
        failureNote: null,
        canRetry: false,
        canDelete: false,
      };
    case "failed":
      return {
        label: "Falhou",
        tone: "warning",
        failureNote:
          "Não foi possível iniciar o banco no servidor. Tente de novo; se continuar falhando, confira o espaço em disco e a conexão do servidor.",
        canRetry: true,
        canDelete: true,
      };
    case "running":
      return {
        label: "Ativo",
        tone: "success",
        failureNote:
          database.errorMessage == null
            ? null
            : "Não foi possível excluir o banco. Tente de novo em instantes.",
        canRetry: false,
        canDelete: true,
      };
  }
}

/**
 * Returns the version part of an image reference, such as "18.6" for "postgres:18.6-alpine".
 *
 * @param imageTag - Image reference with a tag.
 * @returns The version, or the whole tag when it does not start with a version number.
 */
export function engineVersion(imageTag: string): string {
  const tag = imageTag.split(":").at(-1) ?? imageTag;
  const version = /^\d+(?:\.\d+)*/.exec(tag);
  return version?.[0] ?? tag;
}
