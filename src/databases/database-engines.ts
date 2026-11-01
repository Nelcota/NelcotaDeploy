import type { DatabaseEngineName } from "@/shared/schemas/database.schema";

import type { DatabaseEngine } from "./engines/database-engine.strategy";
import { postgresEngine } from "./engines/postgres.engine";
import { redisEngine } from "./engines/redis.engine";

const ENGINES = {
  postgres: postgresEngine,
  redis: redisEngine,
} as const satisfies Record<DatabaseEngineName, DatabaseEngine>;

/**
 * Returns how a database engine runs.
 *
 * @param name - Engine name.
 * @returns The engine.
 */
export function databaseEngine(name: DatabaseEngineName): DatabaseEngine {
  return ENGINES[name];
}
