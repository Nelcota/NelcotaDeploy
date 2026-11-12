import { createFileRoute } from "@tanstack/react-router";

import { getUserAvatar } from "@/auth";
import { getDatabase } from "@/db";
import { accessErrorResponse, authorizeHeaders } from "@/web/server/authorization";

const MAX_USER_ID_LENGTH = 128;
// A cached image must pass authorization again before the browser can reuse it.
const AVATAR_CACHE = "private, no-cache";

export const Route = createFileRoute("/api/avatars/$userId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          await authorizeHeaders(request.headers, "project:read");
        } catch (error) {
          return accessErrorResponse(error);
        }

        const userId = params.userId.trim();
        if (userId === "" || userId.length > MAX_USER_ID_LENGTH) {
          return new Response("Not found", { status: 404 });
        }
        const avatar = getUserAvatar(getDatabase(), userId);
        if (avatar == null) {
          return new Response("Not found", { status: 404 });
        }
        const etag = `"${userId}-${Date.parse(avatar.updatedAt)}"`;
        const headers = {
          "Cache-Control": AVATAR_CACHE,
          ETag: etag,
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; sandbox",
        };
        if (request.headers.get("If-None-Match") === etag) {
          return new Response(null, { status: 304, headers });
        }
        return new Response(new Uint8Array(avatar.content), {
          headers: { ...headers, "Content-Type": avatar.contentType },
        });
      },
    },
  },
});
