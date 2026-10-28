/** Side of the square photo sent to the server, in pixels; it is shown at 40 px at most. */
export const AVATAR_SIZE_IN_PX = 256;

/** Largest file picked by the user; bigger photos are refused before decoding. */
export const MAX_SOURCE_IMAGE_BYTES = 20 * 1024 * 1024;

// btoa takes a string of bytes; building it in chunks avoids a call with too many arguments.
const BASE64_CHUNK_BYTES = 0x8000;

/** Region of the source image to keep, in source pixels. */
type SquareCrop = {
  readonly x: number;
  readonly y: number;
  readonly size: number;
};

/**
 * Picks the largest centered square of an image, so a photo is cropped instead of stretched.
 *
 * @param width - Source width in pixels; must be a positive finite number.
 * @param height - Source height in pixels; must be a positive finite number.
 * @returns The square's top-left corner and side, in source pixels.
 * @throws {RangeError} When a dimension is not a positive finite number.
 */
export function centerSquareCrop(width: number, height: number): SquareCrop {
  if (Number.isFinite(width) === false || Number.isFinite(height) === false) {
    throw new RangeError(`Image size must be finite, got ${width}×${height}`);
  }
  if (width <= 0 || height <= 0) {
    throw new RangeError(`Image size must be positive, got ${width}×${height}`);
  }
  const size = Math.min(width, height);
  return { x: Math.floor((width - size) / 2), y: Math.floor((height - size) / 2), size };
}

/**
 * Encodes bytes as base64, the format the upload server function accepts.
 *
 * @param bytes - Content to encode.
 * @returns The base64 text, empty for empty content.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_BYTES) {
    parts.push(String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_BYTES)));
  }
  return btoa(parts.join(""));
}
