import { resolve } from "node:path";

import { getConfig } from "@/config";
import { createLogger } from "@/logging";

import { serveStaticAsset } from "./server/assets/static-response";

/**
 * Production HTTP server: serves the built client assets and hands every other request to
 * the TanStack Start server bundle.
 */
type ServerEntry = { readonly fetch: (request: Request) => Promise<Response> | Response };

const CLIENT_DIRECTORY = resolve("dist/client");
const SERVER_ENTRY = resolve("dist/server/server.js");
// 2 MiB.
const MAX_REQUEST_BODY_BYTES = 2_097_152;
/** SSE streams send a heartbeat every 15 s, well within this idle limit. */
const IDLE_TIMEOUT_IN_SECONDS = 60;

const logger = createLogger("web");
const config = getConfig();
const entry = (await import(SERVER_ENTRY)) as { default: ServerEntry };

const server = Bun.serve({
  port: config.PORT,
  hostname: process.env["HOST"] ?? "0.0.0.0",
  maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
  idleTimeout: IDLE_TIMEOUT_IN_SECONDS,
  async fetch(request) {
    const url = new URL(request.url);
    if ((request.method === "GET" || request.method === "HEAD") && url.pathname !== "/") {
      const file = await serveStaticAsset(request, CLIENT_DIRECTORY);
      if (file != null) {
        return file;
      }
    }
    return await entry.default.fetch(request);
  },
  error(error) {
    logger.error({ err: error }, "unhandled request error");
    return new Response("Erro interno", { status: 500 });
  },
});

logger.info({ url: server.url.href }, "web server listening");
