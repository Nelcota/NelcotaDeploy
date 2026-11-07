import { resolve, sep } from "node:path";

import { acceptsGzip } from "./content-encoding";

const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

/** Serves a static file or its precompressed equivalent with representation-specific headers. */
export async function serveStaticAsset(
  request: Request,
  directory: string,
): Promise<Response | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(new URL(request.url).pathname);
  } catch {
    return null;
  }
  const root = resolve(directory);
  const path = resolve(root, `.${decoded}`);
  if (path.startsWith(`${root}${sep}`) === false) {
    return null;
  }
  const file = Bun.file(path);
  if ((await file.exists()) === false) {
    return null;
  }
  const compressed = Bun.file(`${path}.gz`);
  const hasCompressed = await compressed.exists();
  const useCompressed = hasCompressed && acceptsGzip(request.headers.get("accept-encoding"));
  const representation = useCompressed ? compressed : file;
  const headers = new Headers({
    "Cache-Control": decoded.startsWith("/assets/") ? IMMUTABLE_CACHE : "public, max-age=300",
    "Content-Type": file.type === "" ? "application/octet-stream" : file.type,
    "Content-Length": String(representation.size),
    "X-Content-Type-Options": "nosniff",
  });
  if (hasCompressed) {
    headers.set("Vary", "Accept-Encoding");
  }
  if (useCompressed) {
    headers.set("Content-Encoding", "gzip");
  }
  return new Response(request.method === "HEAD" ? null : representation, { headers });
}
