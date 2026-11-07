import type { Actor } from "@/audit";
import type { Database } from "@/db";
import type { SecretBox } from "@/secrets";
import {
  environmentImportSchema,
  type EnvironmentImportInput,
  suggestedVariableKind,
} from "@/shared/schemas/environment/environment-import.schema";

import {
  listEnvironmentVariables,
  prepareEnvironmentVariable,
} from "./environment-variable.service";
import { EnvironmentImportConflictError } from "./environment.errors";

/**
 * Encrypts and imports a validated batch atomically, preserving existing build and preview settings.
 *
 * @param database - Database.
 * @param secretBox - Encryption box.
 * @param request - Project, reviewed values and actor.
 * @returns Number of saved variables.
 * @throws {EnvironmentImportConflictError} When a reviewed variable was changed concurrently.
 */
export async function importEnvironmentVariables(
  database: Database,
  secretBox: SecretBox,
  request: {
    readonly projectId: string;
    readonly input: EnvironmentImportInput;
    readonly actor: Actor;
  },
): Promise<number> {
  const input = environmentImportSchema.parse(request.input);
  const existing = new Map(
    listEnvironmentVariables(database, request.projectId).map((variable) => [
      variable.key,
      variable,
    ]),
  );
  const writes = await Promise.all(
    input.entries.map(async (entry) => {
      const previous = existing.get(entry.key);
      const kind =
        input.kind === "automatic"
          ? (previous?.kind ?? entry.kind ?? suggestedVariableKind(entry.key, entry.value))
          : input.kind;
      return await prepareEnvironmentVariable(database, secretBox, {
        projectId: request.projectId,
        actor: request.actor,
        input: {
          key: entry.key,
          value: entry.value,
          kind,
          availableAtBuild: previous?.availableAtBuild ?? false,
          excludeFromPreviews: previous?.excludeFromPreviews ?? kind === "secret",
        },
      });
    }),
  );
  database.transaction(
    (transaction) => {
      const current = new Map(
        listEnvironmentVariables(transaction, request.projectId).map((variable) => [
          variable.key,
          variable.updatedAt,
        ]),
      );
      for (const entry of input.entries) {
        if ((current.get(entry.key) ?? null) !== entry.expectedUpdatedAt) {
          throw new EnvironmentImportConflictError(entry.key);
        }
      }
      for (const write of writes) {
        write(transaction);
      }
    },
    { behavior: "immediate" },
  );
  return input.entries.length;
}
