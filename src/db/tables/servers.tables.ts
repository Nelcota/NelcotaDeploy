import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { createdAt, updatedAt } from "./columns";

/** Id of the server the panel itself runs on; it always exists. */
export const LOCAL_SERVER_ID = "local";

export const servers = sqliteTable("servers", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  // "local" uses the Docker of the worker's own host; "ssh" reaches another VPS over SSH.
  kind: text("kind", { enum: ["local", "ssh"] }).notNull(),
  host: text("host"),
  port: integer("port"),
  username: text("username"),
  // Pinned when the server first becomes ready (trust on first use), then required.
  hostKeyFingerprint: text("host_key_fingerprint"),
  // Address that DNS records of projects on this server point at.
  publicAddress: text("public_address"),
  acceptsApplications: integer("accepts_applications", { mode: "boolean" }).notNull().default(true),
  status: text("status", { enum: ["pending", "ready", "unreachable"] }).notNull(),
  statusMessage: text("status_message"),
  dockerVersion: text("docker_version"),
  lastSeenAt: text("last_seen_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
