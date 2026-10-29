// Restores an off-site backup to a new file:
//   bun run db:restore --list
//   bun run db:restore --latest --output ./restored.db
//   bun run db:restore --key nelcota/nelcota-20261029T033000Z.db.enc --output ./restored.db
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { getConfig } from "@/config";
import { createLogger } from "@/logging";
import { getSecretBox } from "@/secrets";

import { offsiteStoreFromConfig } from "./offsite-backup";
import { newestBackupKey, restoreBackupTo } from "./restore";

const logger = createLogger("db-restore");
const { values } = parseArgs({
  options: {
    list: { type: "boolean", default: false },
    latest: { type: "boolean", default: false },
    key: { type: "string" },
    output: { type: "string" },
  },
});

const config = getConfig();
const store = offsiteStoreFromConfig(config);
if (store == null) {
  logger.error("set BACKUP_S3_BUCKET, BACKUP_S3_ACCESS_KEY_ID and BACKUP_S3_SECRET_ACCESS_KEY");
  process.exit(1);
}
const keys = await store.list(config.BACKUP_S3_PREFIX);
if (values.list) {
  for (const key of keys.toSorted()) {
    process.stdout.write(`${key}\n`);
  }
  process.exit(0);
}
const key = values.latest ? newestBackupKey(keys) : (values.key ?? null);
const output = values.output?.trim() ?? "";
if (key == null || output === "") {
  logger.error("usage: bun run db:restore (--latest | --key <key>) --output <new file>");
  process.exit(1);
}
const written = await restoreBackupTo(store, await getSecretBox(), {
  key,
  output: resolve(output),
});
logger.info({ key, output: resolve(output), bytes: written }, "backup restored to a new file");
process.stdout.write(
  "Pare o painel e o worker, troque o arquivo do banco por este e remova os -wal/-shm antigos.\n",
);
