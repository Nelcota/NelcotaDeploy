import { createFileRoute } from "@tanstack/react-router";

import { getCurrentUser, getUserAvatar } from "@/auth";
import { getDatabase } from "@/db";

const MAX_USER_ID_LENGTH = 128;
// The address carries a version that changes on every upload, so a copy never goes stale.
const AVATAR_CACHE = "private, max-age=31536000, immutable";

export const Route = createFileRoute("/api/avatars/$userId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const user = await getCurrentUser(request.headers);
        if (user == null) {
          return new Response("Unauthorized", { status: 401 });
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
