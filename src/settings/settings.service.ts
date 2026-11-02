import { eq, inArray } from "drizzle-orm";

import { type Database, tables } from "@/db";
import { DEFAULT_SYSTEM_SETTINGS, type SystemSettings } from "@/shared/schemas/settings.schema";

import { assertHostnameOwnership } from "./hostname-ownership";

const SETTING_KEYS = Object.keys(DEFAULT_SYSTEM_SETTINGS) as (keyof SystemSettings)[];

/**
 * Reads system settings, filling missing keys with defaults.
 *
 * @param database - Database.
 * @param options - Whether the caller may receive secret webhook credentials (server-only by default).
 * @returns The effective settings.
 */
export function getSystemSettings(
  database: Pick<Database, "select">,
  options: { readonly includeSecrets?: boolean } = {},
): SystemSettings {
  const rows = database
    .select({ key: tables.systemSettings.key, value: tables.systemSettings.value })
    .from(tables.systemSettings)
    .where(inArray(tables.systemSettings.key, SETTING_KEYS))
    .all();
  const stored = new Map(rows.map((row) => [row.key, row.value]));
  return {
    organizationName: readString(
      stored.get("organizationName"),
      DEFAULT_SYSTEM_SETTINGS.organizationName,
    ),
    baseDomain: readNullableString(stored.get("baseDomain")),
    httpsByDefault: readBoolean(
      stored.get("httpsByDefault"),
      DEFAULT_SYSTEM_SETTINGS.httpsByDefault,
    ),
    alertWebhookUrl:
      options.includeSecrets === false ? null : readNullableString(stored.get("alertWebhookUrl")),
  };
}

/**
 * Saves every system setting in one transaction.
 *
 * @param database - Database.
 * @param settings - Validated settings.
 */
export function saveSystemSettings(database: Database, settings: SystemSettings): void {
  const updatedAt = new Date().toISOString();
  database.transaction(
    (transaction) => {
      assertHostnameOwnership(transaction, settings);
      for (const key of SETTING_KEYS) {
        // The column cannot hold NULL; a missing row already reads back as "not set".
        if (settings[key] == null) {
          transaction.delete(tables.systemSettings).where(eq(tables.systemSettings.key, key)).run();
          continue;
        }
        transaction
          .insert(tables.systemSettings)
          .values({ key, value: settings[key], updatedAt })
          .onConflictDoUpdate({
            target: tables.systemSettings.key,
            set: { value: settings[key], updatedAt },
          })
          .run();
      }
    },
    { behavior: "immediate" },
  );
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}
