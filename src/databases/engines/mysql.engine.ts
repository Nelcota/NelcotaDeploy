import type { DatabaseEngine } from "./database-engine.strategy";

const MYSQL_PORT = 3306;
const MYSQL_USER = "app";
const MYSQL_DATABASE = "app";

// The password stays in the container's environment: these scripts read it from there, so it
// never appears in a command line. The dump path is passed as "$1", never inside the script.
const DUMP_SCRIPT =
  'exec mysqldump --user=root --password="$MYSQL_ROOT_PASSWORD" --single-transaction ' +
  `--routines --triggers --add-drop-database --databases ${MYSQL_DATABASE} --result-file="$1"`;
const RESTORE_SCRIPT = 'exec mysql --user=root --password="$MYSQL_ROOT_PASSWORD" < "$1"';

/**
 * MySQL, through the official image on its long-term support line, which keeps the data format
 * stable across the updates a redeploy may pull.
 */
export const mysqlEngine: DatabaseEngine = {
  label: "MySQL",
  imageTag: "mysql:9.7.4",
  port: MYSQL_PORT,
  dataPath: "/var/lib/mysql",
  user: MYSQL_USER,
  databaseName: MYSQL_DATABASE,
  containerSettings: (password) => ({
    environment: {
      MYSQL_DATABASE,
      MYSQL_USER,
      MYSQL_PASSWORD: password,
      // Only backups use root, from inside the container.
      MYSQL_ROOT_PASSWORD: password,
    },
    command: [],
  }),
  connectionUrl: (host, password) =>
    `mysql://${MYSQL_USER}:${encodeURIComponent(password)}@${host}:${MYSQL_PORT}/${MYSQL_DATABASE}`,
  // Over TCP: while the image initializes, its temporary server listens only on the socket.
  // mysqladmin ping succeeds once the server answers, even when it refuses the login.
  readinessCommand: ["mysqladmin", "ping", "--host=127.0.0.1", "--silent"],
  isReady: (result) => result.exitCode === 0,
  // The dump drops and recreates the database, so restoring replaces what is there.
  backup: {
    dump: (path) => ["sh", "-c", DUMP_SCRIPT, "sh", path],
    restore: (path) => ["sh", "-c", RESTORE_SCRIPT, "sh", path],
  },
};
