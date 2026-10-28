import { resolve, sep } from "node:path";

import { getConfig } from "@/config";
import { createLogger } from "@/logging";

/**
 * Production HTTP server: serves the built client assets and hands every other request to
 * the TanStack Start server bundle.
 */
type ServerEntry = { readonly fetch: (request: Request) => Promise<Response> | Response };

const CLIENT_DIRECTORY = resolve("dist/client");
const SERVER_ENTRY = resolve("dist/server/server.js");
const MAX_REQUEST_BODY_BYTES = 2 * 1024 * 1024;
/** SSE streams send a heartbeat every 15 s, well within this idle limit. */
const IDLE_TIMEOUT_IN_SECONDS = 60;
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

const logger = createLogger("web");
const config = getConfig();
const entry = (await import(SERVER_ENTRY)) as { default: ServerEntry };

async function serveStaticFile(pathname: string): Promise<Response | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const path = resolve(CLIENT_DIRECTORY, `.${decoded}`);
  // Refuses ../ tricks: the resolved file must stay inside the client directory.
  if (path.startsWith(`${CLIENT_DIRECTORY}${sep}`) === false) {
    return null;
  }
  const file = Bun.file(path);
  if ((await file.exists()) === false) {
    return null;
  }
  const cacheControl = decoded.startsWith("/assets/") ? IMMUTABLE_CACHE : "public, max-age=300";
  return new Response(file, {
    headers: { "Cache-Control": cacheControl, "X-Content-Type-Options": "nosniff" },
  });
}

const server = Bun.serve({
  port: config.PORT,
  hostname: process.env["HOST"] ?? "0.0.0.0",
  maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
  idleTimeout: IDLE_TIMEOUT_IN_SECONDS,
  async fetch(request) {
    const url = new URL(request.url);
    if ((request.method === "GET" || request.method === "HEAD") && url.pathname !== "/") {
      const file = await serveStaticFile(url.pathname);
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
