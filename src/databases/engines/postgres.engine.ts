import type { DatabaseEngine } from "./database-engine.strategy";

const POSTGRES_PORT = 5432;
const POSTGRES_USER = "app";
const POSTGRES_DATABASE = "app";

// psql expands quoted variables only in input scripts, so SQL travels through stdin.
const ACTIVATE_RESTORE_SCRIPT = `printf '%s\\n' "$4" | psql --no-psqlrc \
  --username app --dbname postgres --set ON_ERROR_STOP=1 --single-transaction \
  --set "staging=$1" --set "retired=$2" --set "database=$3" --file -`;

// Each container holds one application database. The catalog lock blocks new connections
// during the short rename transaction; rollback preserves the original name on any failure.
const ACTIVATE_RESTORE_SQL = `SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE pg_catalog.pg_database IN ACCESS EXCLUSIVE MODE;
SELECT pg_terminate_backend(pid, 10000) FROM pg_stat_activity WHERE datname = :'database';
ALTER DATABASE :"database" RENAME TO :"retired";
ALTER DATABASE :"staging" RENAME TO :"database";`;

function restorePlan(path: string) {
  const attemptId = Bun.randomUUIDv7().replaceAll("-", "");
  const staging = `nelcota_restore_${attemptId}`;
  const retired = `nelcota_retired_${attemptId}`;
  return {
    commands: [
      ["pg_restore", "--list", path],
      ["createdb", "--username", POSTGRES_USER, "--template", "template0", staging],
      [
        "pg_restore",
        "--username",
        POSTGRES_USER,
        "--dbname",
        staging,
        "--single-transaction",
        "--no-owner",
        "--exit-on-error",
        path,
      ],
      [
        "sh",
        "-c",
        ACTIVATE_RESTORE_SCRIPT,
        "sh",
        staging,
        retired,
        POSTGRES_DATABASE,
        ACTIVATE_RESTORE_SQL,
      ],
    ],
    cleanup: [staging, retired].map((name) => [
      "dropdb",
      "--username",
      POSTGRES_USER,
      "--maintenance-db",
      "postgres",
      "--if-exists",
      "--force",
      name,
    ]),
  };
}

/**
 * PostgreSQL, through the official image. From version 18 on the image keeps its data in a
 * versioned directory below /var/lib/postgresql, so that is the directory the volume keeps.
 */
export const postgresEngine: DatabaseEngine = {
  imageTag: "postgres:18.6-alpine",
  port: POSTGRES_PORT,
  dataPath: "/var/lib/postgresql",
  user: POSTGRES_USER,
  databaseName: POSTGRES_DATABASE,
  containerSettings: (password) => ({
    environment: {
      POSTGRES_USER,
      POSTGRES_DB: POSTGRES_DATABASE,
      POSTGRES_PASSWORD: password,
    },
    command: [],
  }),
  connectionUrl: (host, password) =>
    `postgresql://${POSTGRES_USER}:${encodeURIComponent(password)}@${host}:${POSTGRES_PORT}/${POSTGRES_DATABASE}`,
  // Over TCP: while the image initializes, its temporary server listens only on the socket.
  readinessCommand: ["pg_isready", "--host", "127.0.0.1", "--username", POSTGRES_USER],
  isReady: (result) => result.exitCode === 0,
  // Over the local socket, which the image trusts, so no password is needed. The custom format
  // is compressed. Restore loads privately before atomically replacing the public database.
  backup: {
    dump: (path) => [
      "pg_dump",
      "--username",
      POSTGRES_USER,
      "--dbname",
      POSTGRES_DATABASE,
      "--format=custom",
      "--file",
      path,
    ],
    restore: restorePlan,
  },
};
