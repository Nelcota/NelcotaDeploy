import type { DatabaseEngine } from "./database-engine.strategy";

const MONGODB_PORT = 27_017;
const MONGODB_USER = "app";
const MONGODB_DATABASE = "app";

// The credentials stay in the container's environment: these scripts read them from there, so
// they never appear in a command line. The archive path is passed as "$1", never in the script.
const CREDENTIALS =
  '--username="$MONGO_INITDB_ROOT_USERNAME" --password="$MONGO_INITDB_ROOT_PASSWORD" ' +
  "--authenticationDatabase=admin";
const DUMP_SCRIPT = `exec mongodump ${CREDENTIALS} --gzip --archive="$1"`;
const RESTORE_SCRIPT = `exec mongorestore ${CREDENTIALS} --drop --gzip --archive="$1"`;
// While the image initializes, its temporary server listens only on 127.0.0.1, so asking
// through the container's own address waits for the real one. The ping needs no login.
const READINESS_SCRIPT = `exec mongosh --host "$HOSTNAME" --quiet --eval "db.adminCommand('ping').ok"`;

/**
 * MongoDB, through the official image, which also ships the shell and the database tools.
 *
 * @remarks
 * The app user is the image's root user, created in the admin database, so the URL names
 * admin as the authentication source.
 */
export const mongodbEngine: DatabaseEngine = {
  label: "MongoDB",
  imageTag: "mongo:9.0.4",
  port: MONGODB_PORT,
  dataPath: "/data/db",
  user: MONGODB_USER,
  databaseName: MONGODB_DATABASE,
  containerSettings: (password) => ({
    environment: {
      MONGO_INITDB_ROOT_USERNAME: MONGODB_USER,
      MONGO_INITDB_ROOT_PASSWORD: password,
      MONGO_INITDB_DATABASE: MONGODB_DATABASE,
    },
    command: [],
  }),
  connectionUrl: (host, password) =>
    `mongodb://${MONGODB_USER}:${encodeURIComponent(password)}@${host}:${MONGODB_PORT}/${MONGODB_DATABASE}?authSource=admin`,
  readinessCommand: ["sh", "-c", READINESS_SCRIPT],
  isReady: (result) => result.exitCode === 0 && result.stdout.trim() === "1",
  // --drop replaces each restored collection, so restoring replaces what is there.
  backup: {
    dump: (path) => ["sh", "-c", DUMP_SCRIPT, "sh", path],
    restore: (path) => ["sh", "-c", RESTORE_SCRIPT, "sh", path],
  },
};
