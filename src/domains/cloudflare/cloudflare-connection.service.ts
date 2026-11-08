import { eq } from "drizzle-orm";
import { z } from "zod";

import { type Actor, recordAuditEvent } from "@/audit";
import { type Database, tables } from "@/db";
import type { SecretBox } from "@/secrets";
import { cloudflareTokenSchema } from "@/shared/schemas/dns/cloudflare.schema";

import { DnsConfigurationError } from "../domain.errors";
import { CLOUDFLARE_API, type CloudflareApi, listCloudflareZones } from "./cloudflare-api";

const SETTING_KEY = "dns.cloudflare";
const SECRET_CONTEXT = "dns:cloudflare:api-token";
const connectionSchema = z.object({
  encryptedToken: z.string().min(1),
  revision: z.string().uuid(),
  connectedAt: z.iso.datetime(),
  zoneCount: z.number().int().nonnegative(),
});

function storedConnection(database: Database) {
  const row = database
    .select({ value: tables.systemSettings.value })
    .from(tables.systemSettings)
    .where(eq(tables.systemSettings.key, SETTING_KEY))
    .get();
  if (row == null) {
    return null;
  }
  const parsed = connectionSchema.safeParse(row.value);
  if (parsed.success === false) {
    throw new DnsConfigurationError("not-connected");
  }
  return parsed.data;
}

/**
 * Returns connection metadata only; API tokens never leave the server.
 *
 * @param database - Panel database.
 * @returns Whether a connection is saved and its last validated zone count.
 * @throws {DnsConfigurationError} When stored connection metadata is invalid.
 */
export function cloudflareConnectionStatus(database: Database) {
  const connection = storedConnection(database);
  return connection == null
    ? { configured: false, connectedAt: null, zoneCount: 0 }
    : { configured: true, connectedAt: connection.connectedAt, zoneCount: connection.zoneCount };
}

export async function readCloudflareConnection(database: Database, box: SecretBox) {
  const connection = storedConnection(database);
  if (connection == null) {
    throw new DnsConfigurationError("not-connected");
  }
  return {
    token: await box.decrypt(connection.encryptedToken, SECRET_CONTEXT),
    revision: connection.revision,
  };
}

/**
 * Validates access to Cloudflare zones and saves the API token encrypted.
 *
 * @param dependencies - Database, encryption and optional test API.
 * @param input - API token and authenticated administrator.
 * @throws {CloudflareApiError} When the token cannot list its zones.
 * @throws {DnsConfigurationError} When no active zone is accessible or pagination exceeds the limit.
 * @throws {ZodError} When the token format is invalid.
 */
export async function connectCloudflare(
  dependencies: {
    readonly database: Database;
    readonly secretBox: SecretBox;
    readonly api?: CloudflareApi;
  },
  input: { readonly token: string; readonly actor: Actor },
): Promise<void> {
  const token = cloudflareTokenSchema.parse(input.token);
  const zones = await listCloudflareZones(dependencies.api ?? CLOUDFLARE_API, token);
  if (zones.length === 0) {
    throw new DnsConfigurationError("zone-not-found");
  }
  const value = {
    encryptedToken: await dependencies.secretBox.encrypt(token, SECRET_CONTEXT),
    revision: crypto.randomUUID(),
    connectedAt: new Date().toISOString(),
    zoneCount: zones.length,
  };
  dependencies.database.transaction(
    (transaction) => {
      transaction
        .insert(tables.systemSettings)
        .values({ key: SETTING_KEY, value, updatedAt: value.connectedAt })
        .onConflictDoUpdate({
          target: tables.systemSettings.key,
          set: { value, updatedAt: value.connectedAt },
        })
        .run();
      recordAuditEvent(transaction, {
        actor: input.actor,
        action: "dns.cloudflare.connect",
        targetType: "settings",
        metadata: { zones: zones.length },
      });
    },
    { behavior: "immediate" },
  );
}

/**
 * Removes the credential without touching any DNS record.
 *
 * @param database - Panel database.
 * @param actor - Authenticated administrator recorded in the audit log.
 */
export function disconnectCloudflare(database: Database, actor: Actor): void {
  database.transaction(
    (transaction) => {
      transaction
        .delete(tables.systemSettings)
        .where(eq(tables.systemSettings.key, SETTING_KEY))
        .run();
      recordAuditEvent(transaction, {
        actor,
        action: "dns.cloudflare.disconnect",
        targetType: "settings",
      });
    },
    { behavior: "immediate" },
  );
}
