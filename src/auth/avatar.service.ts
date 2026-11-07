import { eq } from "drizzle-orm";

import { type Database, tables } from "@/db";

import { InvalidAvatarError } from "./auth.errors";

/** Largest photo accepted (512 KiB); the browser sends a 256×256 WebP of a few tens of KB. */
export const MAX_AVATAR_BYTES = 524_288;
/** At most one 1024×1024 canvas, checked before Bun allocates the decoded pixels. */
export const MAX_AVATAR_PIXELS = 1_048_576;

type AvatarContentType = "image/png" | "image/jpeg" | "image/webp";

const AVATAR_CONTENT_TYPES: Readonly<Partial<Record<Bun.Image.Format, AvatarContentType>>> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};
const INVALID_IMAGE_ERROR_CODES: ReadonlySet<string> = new Set([
  "ERR_IMAGE_UNKNOWN_FORMAT",
  "ERR_IMAGE_FORMAT_UNSUPPORTED",
  "ERR_IMAGE_DECODE_FAILED",
  "ERR_IMAGE_TOO_MANY_PIXELS",
]);

/** Decodes every pixel and returns a fresh encoding in the supported source format. */
async function decodeAvatar(bytes: Uint8Array) {
  try {
    // Bun borrows input bytes while working off-thread; keep our own immutable snapshot.
    const image = new Bun.Image(bytes.slice(), { maxPixels: MAX_AVATAR_PIXELS });
    const { format } = await image.metadata();
    const contentType = AVATAR_CONTENT_TYPES[format];
    if (contentType == null) {
      throw new InvalidAvatarError(`unsupported image format: ${format}`);
    }
    // metadata() alone does not validate the pixel data. Persist only the full decode's output.
    const content = Buffer.from(await image.bytes());
    if (content.length === 0) {
      throw new Error("Avatar encoder returned empty content");
    }
    if (content.length > MAX_AVATAR_BYTES) {
      throw new InvalidAvatarError(
        `encoded image of ${content.length} bytes exceeds ${MAX_AVATAR_BYTES}`,
      );
    }
    return { contentType, content };
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "string" &&
      INVALID_IMAGE_ERROR_CODES.has(error.code)
    ) {
      throw new InvalidAvatarError(`image validation failed (${error.code})`);
    }
    throw error;
  }
}

/**
 * Address the interface uses to show a user's photo. The version changes with every
 * upload, so browsers may cache each address forever.
 */
function avatarUrl(userId: string, updatedAt: Date): string {
  return `/api/avatars/${encodeURIComponent(userId)}?v=${updatedAt.getTime()}`;
}

/**
 * Fully decodes and re-encodes a user's profile photo before replacing the previous one.
 *
 * @param database - Database.
 * @param upload - `userId` whose photo changes, the image `bytes` (PNG, JPEG or WebP, up to
 *   {@link MAX_AVATAR_BYTES} bytes and {@link MAX_AVATAR_PIXELS} pixels) and `now`, the time
 *   of the change, injectable for tests. The stored encoding must fit the byte limit too.
 * @returns The address of the new photo, also saved as the user's `image`.
 * @throws {InvalidAvatarError} When the content is empty, too large or not a supported image.
 */
export async function saveUserAvatar(
  database: Database,
  {
    userId,
    bytes,
    now = new Date(),
  }: { readonly userId: string; readonly bytes: Uint8Array; readonly now?: Date },
): Promise<string> {
  if (bytes.length === 0) {
    throw new InvalidAvatarError("empty file");
  }
  if (bytes.length > MAX_AVATAR_BYTES) {
    throw new InvalidAvatarError(`${bytes.length} bytes exceeds ${MAX_AVATAR_BYTES}`);
  }
  const { contentType, content } = await decodeAvatar(bytes);
  const url = avatarUrl(userId, now);
  database.transaction(
    (transaction) => {
      transaction
        .insert(tables.userAvatars)
        .values({ userId, contentType, content, updatedAt: now.toISOString() })
        .onConflictDoUpdate({
          target: tables.userAvatars.userId,
          set: { contentType, content, updatedAt: now.toISOString() },
        })
        .run();
      transaction
        .update(tables.users)
        .set({ image: url, updatedAt: now })
        .where(eq(tables.users.id, userId))
        .run();
    },
    { behavior: "immediate" },
  );
  return url;
}

/**
 * Removes a user's profile photo; the interface falls back to the initials.
 *
 * @param database - Database.
 * @param userId - User whose photo is removed.
 * @param now - Time of the change; injectable for tests.
 */
export function removeUserAvatar(database: Database, userId: string, now: Date = new Date()): void {
  database.transaction(
    (transaction) => {
      transaction.delete(tables.userAvatars).where(eq(tables.userAvatars.userId, userId)).run();
      transaction
        .update(tables.users)
        .set({ image: null, updatedAt: now })
        .where(eq(tables.users.id, userId))
        .run();
    },
    { behavior: "immediate" },
  );
}

/**
 * Reads a user's profile photo.
 *
 * @param database - Database.
 * @param userId - User whose photo is read.
 * @returns The image and when it changed, or null when the user has none.
 */
export function getUserAvatar(database: Database, userId: string) {
  return (
    database
      .select({
        content: tables.userAvatars.content,
        contentType: tables.userAvatars.contentType,
        updatedAt: tables.userAvatars.updatedAt,
      })
      .from(tables.userAvatars)
      .where(eq(tables.userAvatars.userId, userId))
      .get() ?? null
  );
}
