import { eq } from "drizzle-orm";

import { type Database, tables } from "@/db";

import { InvalidAvatarError } from "./auth.errors";

/** Largest photo accepted; the browser sends a 256×256 WebP of a few tens of KB. */
export const MAX_AVATAR_BYTES = 512 * 1024;

type AvatarContentType = "image/png" | "image/jpeg" | "image/webp";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;
const RIFF = "RIFF";
const WEBP = "WEBP";
const WEBP_TAG_OFFSET = 8;
const WEBP_HEADER_LENGTH = 12;

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

/**
 * Detects the image format from the file's first bytes, ignoring its name or declared type.
 *
 * @param bytes - File content.
 * @returns The content type, or null when it is not a PNG, JPEG or WebP image.
 */
export function detectImageType(bytes: Uint8Array): AvatarContentType | null {
  if (startsWith(bytes, PNG_SIGNATURE)) {
    return "image/png";
  }
  if (startsWith(bytes, JPEG_SIGNATURE)) {
    return "image/jpeg";
  }
  if (
    bytes.length >= WEBP_HEADER_LENGTH &&
    asciiAt(bytes, 0, RIFF.length) === RIFF &&
    asciiAt(bytes, WEBP_TAG_OFFSET, WEBP.length) === WEBP
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * Address the interface uses to show a user's photo. The version changes with every
 * upload, so browsers may cache each address forever.
 */
function avatarUrl(userId: string, updatedAt: Date): string {
  return `/api/avatars/${encodeURIComponent(userId)}?v=${updatedAt.getTime()}`;
}

/**
 * Stores a user's profile photo, replacing the previous one.
 *
 * @param database - Database.
 * @param upload - `userId` whose photo changes, the image `bytes` (PNG, JPEG or WebP, up to
 *   {@link MAX_AVATAR_BYTES} bytes) and `now`, the time of the change, injectable for tests.
 * @returns The address of the new photo, also saved as the user's `image`.
 * @throws {InvalidAvatarError} When the content is empty, too large or not a supported image.
 */
export function saveUserAvatar(
  database: Database,
  {
    userId,
    bytes,
    now = new Date(),
  }: { readonly userId: string; readonly bytes: Uint8Array; readonly now?: Date },
): string {
  if (bytes.length === 0) {
    throw new InvalidAvatarError("empty file");
  }
  if (bytes.length > MAX_AVATAR_BYTES) {
    throw new InvalidAvatarError(`${bytes.length} bytes exceeds ${MAX_AVATAR_BYTES}`);
  }
  const contentType = detectImageType(bytes);
  if (contentType == null) {
    throw new InvalidAvatarError("not a PNG, JPEG or WebP image");
  }
  const url = avatarUrl(userId, now);
  const content = Buffer.from(bytes);
  database.transaction((transaction) => {
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
  });
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
  database.transaction((transaction) => {
    transaction.delete(tables.userAvatars).where(eq(tables.userAvatars.userId, userId)).run();
    transaction
      .update(tables.users)
      .set({ image: null, updatedAt: now })
      .where(eq(tables.users.id, userId))
      .run();
  });
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
