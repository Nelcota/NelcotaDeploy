import { asc, eq } from "drizzle-orm";

import { type Database, tables } from "@/db";
import type { SecretBox } from "@/secrets";
import type { EnvironmentVariableInput } from "@/shared/schemas/environment-variable.schema";

import { encryptionContext, productionEnvironmentId } from "./environment-variable.service";

/**
 * Reads every variable of a project with its value decrypted, to copy them to another project.
 * Values never leave the server: only the copy into another project uses them.
 *
 * @param database - Database.
 * @param secretBox - Encryption box.
 * @param projectId - Project whose variables are read.
 * @returns The variables as inputs to save elsewhere, sorted by key.
 * @throws {ProjectNotFoundError} When the project does not exist.
 * @throws {SecretDecryptionError} When a stored secret cannot be decrypted with the current key.
 */
export async function readVariablesForCopy(
  database: Database,
  secretBox: SecretBox,
  projectId: string,
): Promise<EnvironmentVariableInput[]> {
  const environmentId = productionEnvironmentId(database, projectId);
  const rows = database
    .select({
      key: tables.environmentVariables.key,
      kind: tables.environmentVariables.kind,
      plainValue: tables.environmentVariables.plainValue,
      encryptedValue: tables.environmentVariables.encryptedValue,
      availableAtBuild: tables.environmentVariables.availableAtBuild,
      excludeFromPreviews: tables.environmentVariables.excludeFromPreviews,
    })
    .from(tables.environmentVariables)
    .where(eq(tables.environmentVariables.environmentId, environmentId))
    .orderBy(asc(tables.environmentVariables.key))
    .all();
  return await Promise.all(
    rows.map(async (row) => ({
      key: row.key,
      kind: row.kind,
      value:
        row.kind === "secret"
          ? await secretBox.decrypt(
              row.encryptedValue ?? "",
              encryptionContext(environmentId, row.key),
            )
          : (row.plainValue ?? ""),
      availableAtBuild: row.availableAtBuild,
      excludeFromPreviews: row.excludeFromPreviews,
    })),
  );
}
