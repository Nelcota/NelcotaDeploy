import { describe, expect, test } from "bun:test";
import { randomFillSync } from "node:crypto";

import { eq } from "drizzle-orm";

import { type Database, openMemoryDatabase, tables } from "@/db";

import { InvalidAvatarError } from "./auth.errors";
import {
  getUserAvatar,
  MAX_AVATAR_BYTES,
  MAX_AVATAR_PIXELS,
  removeUserAvatar,
  saveUserAvatar,
} from "./avatar.service";

const NOW = new Date("2026-10-28T12:00:00.000Z");
const PNG = Uint8Array.fromBase64(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
);
const JPEG = await new Bun.Image(PNG).jpeg().bytes();
const WEBP = await new Bun.Image(PNG).webp({ lossless: true }).bytes();

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

async function expectInvalidAvatar(saving: Promise<string>, message?: string): Promise<void> {
  const error = await saving.catch((failure: unknown) => failure);
  expect(error).toBeInstanceOf(InvalidAvatarError);
  if (message != null && error instanceof Error) {
    expect(error.message).toContain(message);
  }
}

describe("saveUserAvatar formats", () => {
  test.each([
    [PNG, "image/png"],
    [JPEG, "image/jpeg"],
    [WEBP, "image/webp"],
  ] as const)("recognizes and fully decodes %#", async (bytes, expected) => {
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const userId = createUser(database);
    await saveUserAvatar(database, { userId, bytes, now: NOW });
    const avatar = getUserAvatar(database, userId);
    expect(avatar?.contentType).toBe(expected);
    if (avatar == null) throw new Error("Expected the decoded avatar to be stored");
    expect(await new Bun.Image(avatar.content).png().bytes()).not.toHaveLength(0);
  });

  test("rejects content that is not an image", async () => {
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const userId = createUser(database);
    await expectInvalidAvatar(
      saveUserAvatar(database, {
        userId,
        bytes: new TextEncoder().encode("<svg onload=alert(1)>"),
      }),
    );
  });

  test("rejects a RIFF file that is not WebP", async () => {
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const userId = createUser(database);
    await expectInvalidAvatar(
      saveUserAvatar(database, {
        userId,
        bytes: new TextEncoder().encode("RIFF\u0000\u0000\u0000\u0000WAVEfmt "),
      }),
    );
  });

  test("rejects empty content", async () => {
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const userId = createUser(database);
    await expectInvalidAvatar(saveUserAvatar(database, { userId, bytes: new Uint8Array() }));
  });
});

describe("saveUserAvatar", () => {
  test("stores the photo and points the user's image at a versioned address", async () => {
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const userId = createUser(database);

    const url = await saveUserAvatar(database, { userId, bytes: WEBP, now: NOW });

    expect(url).toBe(`/api/avatars/user-1?v=${NOW.getTime()}`);
    expect(imageOf(database, userId)).toBe(url);
    expect(getUserAvatar(database, userId)?.contentType).toBe("image/webp");
  });

  test("replaces the previous photo", async () => {
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const userId = createUser(database);
    await saveUserAvatar(database, { userId, bytes: WEBP, now: NOW });

    await saveUserAvatar(database, {
      userId,
      bytes: PNG,
      now: new Date("2026-10-28T13:00:00.000Z"),
    });

    const avatar = getUserAvatar(database, userId);
    expect(avatar?.contentType).toBe("image/png");
    expect(avatar?.updatedAt).toBe("2026-10-28T13:00:00.000Z");
  });
});

describe("saveUserAvatar validation", () => {
  test("throws InvalidAvatarError for an empty file", async () => {
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const userId = createUser(database);

    await expectInvalidAvatar(
      saveUserAvatar(database, { userId, bytes: new Uint8Array(), now: NOW }),
    );
  });

  test("throws InvalidAvatarError above the size limit", async () => {
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const userId = createUser(database);
    const tooLarge = Buffer.concat([PNG, Buffer.alloc(MAX_AVATAR_BYTES + 1 - PNG.length)]);

    await expectInvalidAvatar(saveUserAvatar(database, { userId, bytes: tooLarge, now: NOW }));
  });

  test("accepts a photo exactly at the size limit", async () => {
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const userId = createUser(database);
    const atLimit = Buffer.concat([PNG, Buffer.alloc(MAX_AVATAR_BYTES - PNG.length)]);

    const url = await saveUserAvatar(database, { userId, bytes: atLimit, now: NOW });

    expect(url).toContain("/api/avatars/user-1");
  });

  test("throws InvalidAvatarError for content that is not an image", async () => {
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const userId = createUser(database);

    await expectInvalidAvatar(
      saveUserAvatar(database, {
        userId,
        bytes: new TextEncoder().encode("not an image"),
        now: NOW,
      }),
    );
    expect(getUserAvatar(database, userId)).toBeNull();
  });
});

describe("removeUserAvatar", () => {
  test("deletes the photo and clears the user's image", async () => {
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const userId = createUser(database);
    await saveUserAvatar(database, { userId, bytes: WEBP, now: NOW });

    removeUserAvatar(database, userId, NOW);

    expect(getUserAvatar(database, userId)).toBeNull();
    expect(imageOf(database, userId)).toBeNull();
  });

  test("does nothing for a user without a photo", () => {
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const userId = createUser(database);

    removeUserAvatar(database, userId, NOW);

    expect(getUserAvatar(database, userId)).toBeNull();
  });
});

describe("saveUserAvatar decoder validation", () => {
  test.each([
    Uint8Array.fromHex("89504e470d0a1a0a"),
    Uint8Array.fromHex("ffd8ffe00010"),
    new TextEncoder().encode("RIFF\u0000\u0000\u0000\u0000WEBPVP8 "),
  ])("rejects a signature without image data: %#", async (bytes) => {
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const userId = createUser(database);
    await expectInvalidAvatar(saveUserAvatar(database, { userId, bytes }));
    expect(getUserAvatar(database, userId)).toBeNull();
  });

  test.each([PNG, JPEG, WEBP])("rejects a truncated image: %#", async (image) => {
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const userId = createUser(database);
    const bytes = image.slice(0, Math.floor(image.length * 0.6));
    await expectInvalidAvatar(saveUserAvatar(database, { userId, bytes }));
    expect(getUserAvatar(database, userId)).toBeNull();
  });

  test("validates pixel data even when metadata is readable", async () => {
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const userId = createUser(database);
    const truncated = PNG.slice(0, Math.floor(PNG.length * 0.6));
    expect(await new Bun.Image(truncated).metadata()).toEqual({
      format: "png",
      width: 1,
      height: 1,
    });
    await expectInvalidAvatar(
      saveUserAvatar(database, { userId, bytes: truncated }),
      "ERR_IMAGE_DECODE_FAILED",
    );
  });

  test("rejects an otherwise decodable format outside the allowlist", async () => {
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const userId = createUser(database);
    const gif = Uint8Array.fromBase64("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7");
    expect((await new Bun.Image(gif).png().bytes()).length).toBeGreaterThan(0);
    await expectInvalidAvatar(
      saveUserAvatar(database, { userId, bytes: gif }),
      "unsupported image format: gif",
    );
  });

  test("keeps the previous photo and profile address when decoding fails", async () => {
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const userId = createUser(database);
    const url = await saveUserAvatar(database, { userId, bytes: WEBP, now: NOW });
    const previous = getUserAvatar(database, userId);
    await expectInvalidAvatar(saveUserAvatar(database, { userId, bytes: PNG.slice(0, 8) }));
    expect(getUserAvatar(database, userId)).toEqual(previous);
    expect(imageOf(database, userId)).toBe(url);
  });

  test("stores a fresh encoding without trailing input data", async () => {
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const userId = createUser(database);
    const marker = Buffer.from("UNTRUSTED_TRAILING_DATA");
    await saveUserAvatar(database, { userId, bytes: Buffer.concat([PNG, marker]) });
    const avatar = getUserAvatar(database, userId);
    if (avatar == null) throw new Error("Expected the normalized avatar to be stored");
    expect(avatar.content.includes(marker)).toBe(false);
    expect(await new Bun.Image(avatar.content).metadata()).toEqual({
      width: 1,
      height: 1,
      format: "png",
    });
  });

  test("normalizes a recoverable JPEG instead of storing its damaged source", async () => {
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const userId = createUser(database);
    const missingEndMarker = JPEG.slice(0, -2);
    await saveUserAvatar(database, { userId, bytes: missingEndMarker });
    const avatar = getUserAvatar(database, userId);
    if (avatar == null) throw new Error("Expected the normalized JPEG to be stored");
    expect(avatar.content.subarray(-2).toString("hex")).toBe("ffd9");
    expect(avatar.content.equals(Buffer.from(missingEndMarker))).toBe(false);
    expect((await new Bun.Image(avatar.content).png().bytes()).length).toBeGreaterThan(0);
  });

  test("owns the input snapshot while the native decoder works asynchronously", async () => {
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const userId = createUser(database);
    const bytes = PNG.slice();
    const saving = saveUserAvatar(database, { userId, bytes, now: NOW });
    structuredClone(bytes.buffer, { transfer: [bytes.buffer] });
    expect(bytes.byteLength).toBe(0);
    expect(await saving).toBe(`/api/avatars/user-1?v=${NOW.getTime()}`);
    expect(getUserAvatar(database, userId)?.contentType).toBe("image/png");
  });
});

describe("saveUserAvatar resource limits", () => {
  test("accepts a decodable image exactly at the pixel limit", async () => {
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const userId = createUser(database);
    const side = Math.sqrt(MAX_AVATAR_PIXELS);
    const bytes = await new Bun.Image(PNG).resize(side, side).png().bytes();
    await saveUserAvatar(database, { userId, bytes });
    const avatar = getUserAvatar(database, userId);
    if (avatar == null) throw new Error("Expected the maximum-size avatar to be stored");
    expect(await new Bun.Image(avatar.content).metadata()).toEqual({
      format: "png",
      width: side,
      height: side,
    });
  });

  test("rejects a highly compressed image above the pixel limit", async () => {
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const userId = createUser(database);
    const side = Math.sqrt(MAX_AVATAR_PIXELS);
    const bytes = await new Bun.Image(PNG)
      .resize(side + 1, side)
      .png()
      .bytes();
    expect(bytes.length).toBeLessThan(MAX_AVATAR_BYTES);
    await expectInvalidAvatar(
      saveUserAvatar(database, { userId, bytes }),
      "ERR_IMAGE_TOO_MANY_PIXELS",
    );
    expect(getUserAvatar(database, userId)).toBeNull();
  });

  test("rejects a small file claiming an enormous canvas before allocating pixels", async () => {
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const userId = createUser(database);
    const bytes = PNG.slice();
    const header = new DataView(bytes.buffer);
    header.setUint32(16, 1_000_000);
    header.setUint32(20, 1_000_000);
    expect(bytes.length).toBeLessThan(MAX_AVATAR_BYTES);
    await expectInvalidAvatar(
      saveUserAvatar(database, { userId, bytes }),
      "ERR_IMAGE_TOO_MANY_PIXELS",
    );
  });

  test("keeps the previous photo if the normalized output exceeds the byte limit", async () => {
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const userId = createUser(database);
    const url = await saveUserAvatar(database, { userId, bytes: WEBP, now: NOW });
    const previous = getUserAvatar(database, userId);
    const bytes = await new Bun.Image(noisyBitmap()).png({ palette: true, colors: 256 }).bytes();
    expect(bytes.length).toBeLessThanOrEqual(MAX_AVATAR_BYTES);
    expect((await new Bun.Image(bytes).bytes()).length).toBeGreaterThan(MAX_AVATAR_BYTES);
    await expectInvalidAvatar(saveUserAvatar(database, { userId, bytes }), "encoded image");
    expect(getUserAvatar(database, userId)).toEqual(previous);
    expect(imageOf(database, userId)).toBe(url);
  });
});

/** An uncompressed 24-bit BMP supplies native codecs with independent, high-entropy pixels. */
function noisyBitmap(): Buffer {
  const width = 512;
  const height = 768;
  const headerBytes = 54;
  const pixelsBytes = width * height * 3;
  const bitmap = Buffer.alloc(headerBytes + pixelsBytes);
  bitmap.write("BM");
  bitmap.writeUInt32LE(bitmap.length, 2);
  bitmap.writeUInt32LE(headerBytes, 10);
  bitmap.writeUInt32LE(40, 14);
  bitmap.writeInt32LE(width, 18);
  bitmap.writeInt32LE(height, 22);
  bitmap.writeUInt16LE(1, 26);
  bitmap.writeUInt16LE(24, 28);
  bitmap.writeUInt32LE(pixelsBytes, 34);
  randomFillSync(bitmap.subarray(headerBytes));
  return bitmap;
}
