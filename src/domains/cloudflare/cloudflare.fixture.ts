import { z } from "zod";

import type { CloudflareRecord, CloudflareZone } from "./cloudflare-api";

export const FIXTURE_TOKEN = "fixture-cloudflare-api-token-for-tests";
const FIXTURE_ZONE = { id: "a".repeat(32), name: "example.com", status: "active" };
export const FIXTURE_RECORD: CloudflareRecord = {
  id: "b".repeat(32),
  name: "app.example.com",
  type: "A",
  content: "8.8.8.8",
  ttl: 300,
  proxied: true,
};

const desiredSchema = z.object({
  name: z.string(),
  type: z.string(),
  content: z.string(),
  ttl: z.number(),
  proxied: z.boolean(),
});
const batchSchema = z.object({
  deletes: z.array(z.object({ id: z.string() })),
  patches: z.array(desiredSchema.extend({ id: z.string() })),
  posts: z.array(desiredSchema),
});
const PAGE_SIZE = 50;
const HTTP_OK = 200;

/** In-process provider fixture: records evolve after a successful batch, so stale reviews are testable. */
export function createCloudflareFixture(
  input: {
    readonly records?: readonly CloudflareRecord[];
    readonly zones?: readonly CloudflareZone[];
  } = {},
) {
  const state = {
    records: structuredClone([...(input.records ?? [FIXTURE_RECORD])]),
    zones: structuredClone([...(input.zones ?? [FIXTURE_ZONE])]),
    status: HTTP_OK,
    batchStatus: HTTP_OK,
  };
  const requests: { readonly method: string; readonly path: string; readonly body: unknown }[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (request.method === "POST") {
        const body: unknown = await request.json();
        requests.push({ method: request.method, path: url.pathname, body });
        if (state.batchStatus !== HTTP_OK) {
          return Response.json({ success: false }, { status: state.batchStatus });
        }
        const batch = batchSchema.parse(body);
        const removed = new Set(batch.deletes.map((record) => record.id));
        const patches = new Map(batch.patches.map((record) => [record.id, record]));
        const kept = state.records
          .filter((record) => removed.has(record.id) === false)
          .map((record) => Object.assign({}, record, patches.get(record.id)));
        const created = batch.posts.map((record, index) =>
          Object.assign({ id: (requests.length + index).toString(16).padStart(32, "0") }, record),
        );
        state.records = [...kept, ...created];
        return Response.json({ success: true, result: { deletes: [], patches: [], posts: [] } });
      }
      requests.push({ method: request.method, path: url.pathname, body: null });
      if (state.status !== HTTP_OK) {
        return Response.json({ success: false }, { status: state.status });
      }
      const page = Number(url.searchParams.get("page") ?? "1");
      if (Number.isSafeInteger(page) === false || page < 1) {
        return Response.json({}, { status: 400 });
      }
      const rows = url.pathname.endsWith("/zones")
        ? state.zones
        : state.records.filter((record) => record.name === url.searchParams.get("name.exact"));
      return Response.json({
        success: true,
        result: rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
        result_info: { total_pages: Math.ceil(rows.length / PAGE_SIZE) },
      });
    },
  });
  return {
    api: { baseUrl: server.url.origin },
    state,
    requests,
    [Symbol.asyncDispose]: async () => await server.stop(true),
  };
}
