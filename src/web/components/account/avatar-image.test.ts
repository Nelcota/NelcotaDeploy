import { describe, expect, test } from "bun:test";

import { bytesToBase64, centerSquareCrop } from "@/web/components/account/avatar-image";

describe("centerSquareCrop", () => {
  test("keeps the middle of a landscape photo", () => {
    const crop = centerSquareCrop(1600, 900);

    expect(crop).toEqual({ x: 350, y: 0, size: 900 });
  });

  test("keeps the middle of a portrait photo", () => {
    const crop = centerSquareCrop(900, 1601);

    expect(crop).toEqual({ x: 0, y: 350, size: 900 });
  });

  test("keeps the whole image when it is already square", () => {
    const crop = centerSquareCrop(256, 256);

    expect(crop).toEqual({ x: 0, y: 0, size: 256 });
  });

  test.each([
    [0, 100],
    [100, -1],
  ])("throws RangeError for a non-positive size %p×%p", (width, height) => {
    expect(() => centerSquareCrop(width, height)).toThrow(RangeError);
  });

  test.each([
    [Number.NaN, 100],
    [100, Number.POSITIVE_INFINITY],
  ])("throws RangeError for a non-finite size %p×%p", (width, height) => {
    expect(() => centerSquareCrop(width, height)).toThrow(RangeError);
  });
});

describe("bytesToBase64", () => {
  test("encodes like Buffer does", () => {
    const bytes = Uint8Array.from([0, 1, 2, 250, 255]);

    const encoded = bytesToBase64(bytes);

    expect(encoded).toBe(Buffer.from(bytes).toString("base64"));
  });

  test("encodes content larger than one chunk", () => {
    const bytes = new Uint8Array(100_000).map((_, index) => index % 256);

    const encoded = bytesToBase64(bytes);

    expect(encoded).toBe(Buffer.from(bytes).toString("base64"));
  });

  test("returns an empty string for empty content", () => {
    const encoded = bytesToBase64(new Uint8Array());

    expect(encoded).toBe("");
  });
});
