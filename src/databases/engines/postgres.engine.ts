import type { DatabaseEngine } from "./database-engine.strategy";

const POSTGRES_PORT = 5432;
const POSTGRES_USER = "app";
const POSTGRES_DATABASE = "app";

/**
 * PostgreSQL, through the official image. From version 18 on the image keeps its data in a
 * versioned directory below /var/lib/postgresql, so that is the directory the volume keeps.
 */
export const postgresEngine: DatabaseEngine = {
  label: "PostgreSQL",
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
  // is compressed and lets pg_restore replace existing objects.
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
    restore: (path) => [
      "pg_restore",
      "--username",
      POSTGRES_USER,
      "--dbname",
      POSTGRES_DATABASE,
      "--clean",
      "--if-exists",
      "--no-owner",
      path,
    ],
  },
};
