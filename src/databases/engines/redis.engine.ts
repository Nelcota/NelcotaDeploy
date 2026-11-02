import type { DatabaseEngine } from "./database-engine.strategy";

const REDIS_PORT = 6379;
/** Replies of a server that accepts connections, with or without authentication. */
const READY_REPLIES = ["PONG", "NOAUTH"];

/**
 * Redis, through the official image, with append-only persistence so data survives restarts.
 *
 * @remarks
 * The image reads no password from the environment, so it goes in the command. Only those who
 * can already reach the server's Docker can read it there.
 */
export const redisEngine: DatabaseEngine = {
  imageTag: "redis:8.10.3-alpine",
  port: REDIS_PORT,
  dataPath: "/data",
  user: null,
  databaseName: null,
  containerSettings: (password) => ({
    environment: {},
    command: ["redis-server", "--appendonly", "yes", "--requirepass", password],
  }),
  connectionUrl: (host, password) =>
    `redis://default:${encodeURIComponent(password)}@${host}:${REDIS_PORT}`,
  // Without the password the server answers NOAUTH, which still proves it is up.
  readinessCommand: ["redis-cli", "ping"],
  isReady: (result) => {
    const output = `${result.stdout}\n${result.stderr}`;
    return READY_REPLIES.some((reply) => output.includes(reply));
  },
  // Usually a cache; restoring needs the server stopped and its append-only files replaced.
  backup: null,
};
