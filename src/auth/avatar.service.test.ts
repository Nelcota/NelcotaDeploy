import { describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { type Database, openMemoryDatabase, tables } from "@/db";

import { InvalidAvatarError } from "./auth.errors";
import {
  detectImageType,
  getUserAvatar,
  MAX_AVATAR_BYTES,
  removeUserAvatar,
  saveUserAvatar,
} from "./avatar.service";

const NOW = new Date("2026-10-28T12:00:00.000Z");
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const WEBP = new TextEncoder().encode("RIFF\u0000\u0000\u0000\u0000WEBPVP8 ");

function createUser(database: Database): string {
  const id = "user-1";
  database
    .insert(tables.users)
    .values({ id, name: "Ana", email: "ana@example.com", createdAt: NOW, updatedAt: NOW })
    .run();
  return id;
}

function imageOf(database: Database, userId: string): string | null {
  return (
    database
      .select({ image: tables.users.image })
      .from(tables.users)
      .where(eq(tables.users.id, userId))
      .get()?.image ?? null
  );
}

describe("detectImageType", () => {
  test.each([
    [PNG, "image/png"],
    [JPEG, "image/jpeg"],
    [WEBP, "image/webp"],
  ] as const)("recognizes %#", (bytes, expected) => {
    const type = detectImageType(bytes);

    expect(type).toBe(expected);
  });

  test("returns null for content that is not an image", () => {
    const type = detectImageType(new TextEncoder().encode("<svg onload=alert(1)>"));

    expect(type).toBeNull();
  });

  test("returns null for a RIFF file that is not WebP", () => {
    const type = detectImageType(new TextEncoder().encode("RIFF\u0000\u0000\u0000\u0000WAVEfmt "));

    expect(type).toBeNull();
  });

  test("returns null for empty content", () => {
    const type = detectImageType(new Uint8Array());

    expect(type).toBeNull();
  });
});

describe("saveUserAvatar", () => {
  test("stores the photo and points the user's image at a versioned address", () => {
    const database = openMemoryDatabase();
    const userId = createUser(database);

    const url = saveUserAvatar(database, userId, WEBP, NOW);

    expect(url).toBe(`/api/avatars/user-1?v=${NOW.getTime()}`);
    expect(imageOf(database, userId)).toBe(url);
    expect(getUserAvatar(database, userId)?.contentType).toBe("image/webp");
  });

  test("replaces the previous photo", () => {
    const database = openMemoryDatabase();
    const userId = createUser(database);
    saveUserAvatar(database, userId, WEBP, NOW);

    saveUserAvatar(database, userId, PNG, new Date("2026-10-28T13:00:00.000Z"));

    const avatar = getUserAvatar(database, userId);
    expect(avatar?.contentType).toBe("image/png");
    expect(avatar?.updatedAt).toBe("2026-10-28T13:00:00.000Z");
  });

  test("throws InvalidAvatarError for an empty file", () => {
    const database = openMemoryDatabase();
    const userId = createUser(database);

    expect(() => saveUserAvatar(database, userId, new Uint8Array(), NOW)).toThrow(
      InvalidAvatarError,
    );
  });

  test("throws InvalidAvatarError above the size limit", () => {
    const database = openMemoryDatabase();
    const userId = createUser(database);
    const tooLarge = new Uint8Array(MAX_AVATAR_BYTES + 1);
    tooLarge.set(PNG);

    expect(() => saveUserAvatar(database, userId, tooLarge, NOW)).toThrow(InvalidAvatarError);
  });

  test("accepts a photo exactly at the size limit", () => {
    const database = openMemoryDatabase();
    const userId = createUser(database);
    const atLimit = new Uint8Array(MAX_AVATAR_BYTES);
    atLimit.set(PNG);

    const url = saveUserAvatar(database, userId, atLimit, NOW);

    expect(url).toContain("/api/avatars/user-1");
  });

  test("throws InvalidAvatarError for content that is not an image", () => {
    const database = openMemoryDatabase();
    const userId = createUser(database);

    expect(() =>
      saveUserAvatar(database, userId, new TextEncoder().encode("not an image"), NOW),
    ).toThrow(InvalidAvatarError);
    expect(getUserAvatar(database, userId)).toBeNull();
  });
});

describe("removeUserAvatar", () => {
  test("deletes the photo and clears the user's image", () => {
    const database = openMemoryDatabase();
    const userId = createUser(database);
    saveUserAvatar(database, userId, WEBP, NOW);

    removeUserAvatar(database, userId, NOW);

    expect(getUserAvatar(database, userId)).toBeNull();
    expect(imageOf(database, userId)).toBeNull();
  });

  test("does nothing for a user without a photo", () => {
    const database = openMemoryDatabase();
    const userId = createUser(database);

    removeUserAvatar(database, userId, NOW);

    expect(getUserAvatar(database, userId)).toBeNull();
  });
});
