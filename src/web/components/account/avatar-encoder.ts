import { AVATAR_SIZE_IN_PX, centerSquareCrop } from "@/web/components/account/avatar-image";
import { ImageProcessingError } from "@/web/components/account/profile-photo.errors";

const WEBP_QUALITY = 0.85;

/**
 * Crops the picture to a centered square and re-encodes it at the avatar size, so any photo
 * becomes a small WebP (PNG on browsers without WebP encoding).
 *
 * @param file - Image picked by the user.
 * @returns The encoded avatar bytes.
 * @throws {ImageProcessingError} When the browser cannot draw or encode the canvas.
 */
export async function toAvatarBytes(file: File): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(file);
  try {
    const crop = centerSquareCrop(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_SIZE_IN_PX;
    canvas.height = AVATAR_SIZE_IN_PX;
    const context = canvas.getContext("2d");
    if (context == null) {
      throw new ImageProcessingError("2d canvas unavailable");
    }
    context.drawImage(
      bitmap,
      crop.x,
      crop.y,
      crop.size,
      crop.size,
      0,
      0,
      AVATAR_SIZE_IN_PX,
      AVATAR_SIZE_IN_PX,
    );
    const { promise, resolve } = Promise.withResolvers<Blob | null>();
    canvas.toBlob(resolve, "image/webp", WEBP_QUALITY);
    const blob = await promise;
    if (blob == null) {
      throw new ImageProcessingError("canvas could not be encoded");
    }
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    bitmap.close();
  }
}
