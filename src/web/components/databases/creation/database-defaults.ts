import { DATABASE_ENGINES, type DatabaseEngineName } from "@/shared/schemas/database.schema";
import { isValidEnvironmentVariableKey } from "@/shared/schemas/environment-variable.schema";

import { DEFAULT_ENVIRONMENT_KEYS } from "../database-state";

const ENGINE_KEY_PATTERNS: Readonly<Record<DatabaseEngineName, RegExp>> = {
  postgres: /^(?:DATABASE_URL|(?:[A-Z][A-Z0-9]*_)*(?:POSTGRES(?:QL)?|PG|DATABASE)_URL)$/,
  mysql: /^(?:DATABASE_URL|(?:[A-Z][A-Z0-9]*_)*MYSQL_URL)$/,
  mongodb: /^(?:DATABASE_URL|(?:[A-Z][A-Z0-9]*_)*MONGO(?:DB)?_URL)$/,
  redis: /^(?:[A-Z][A-Z0-9]*_)*REDIS_URL$/,
};

function availableKey(base: string, used: ReadonlySet<string>): string {
  if (used.has(base) === false) {
    return base;
  }
  for (let suffix = 2; suffix <= used.size + 2; suffix += 1) {
    const candidate = `${base}_${suffix}`;
    if (used.has(candidate) === false) {
      return candidate;
    }
  }
  throw new Error("Unable to suggest an available database variable");
}

/** Uses a repository's unconfigured connection variable when unambiguous, otherwise a free default. */
export function suggestDatabaseDefaults(input: {
  readonly engine: DatabaseEngineName;
  readonly usedKeys: readonly string[];
  readonly templateKeys: readonly string[];
}) {
  const used = new Set(input.usedKeys);
  const candidates = [...new Set(input.templateKeys)]
    .filter(
      (key) =>
        isValidEnvironmentVariableKey(key) &&
        ENGINE_KEY_PATTERNS[input.engine].test(key) &&
        used.has(key) === false,
    )
    .toSorted();
  const only = candidates.at(0);
  if (candidates.length === 1 && only != null) {
    return { environmentKey: only, fromTemplate: true, candidates };
  }
  return {
    environmentKey: availableKey(DEFAULT_ENVIRONMENT_KEYS[input.engine], used),
    fromTemplate: false,
    candidates,
  };
}

/** Selects an unambiguous engine hint, otherwise preserving the PostgreSQL default. */
export function detectDatabaseEngine(input: {
  readonly usedKeys: readonly string[];
  readonly templateKeys: readonly string[];
}): DatabaseEngineName {
  const requested = DATABASE_ENGINES.filter(
    (engine) => suggestDatabaseDefaults({ ...input, engine }).candidates.length > 0,
  );
  return requested.length === 1 ? (requested.at(0) ?? "postgres") : "postgres";
}
