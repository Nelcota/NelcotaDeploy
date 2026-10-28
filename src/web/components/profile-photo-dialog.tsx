import { useRouter } from "@tanstack/react-router";
import { ImageUpIcon, LoaderCircleIcon, Trash2Icon } from "lucide-react";
import { type ChangeEvent, useRef } from "react";
import { toast } from "sonner";

import { removeAvatarFn, updateAvatarFn } from "@/web/functions/session.functions";

import {
  AVATAR_SIZE_IN_PX,
  bytesToBase64,
  centerSquareCrop,
  MAX_SOURCE_IMAGE_BYTES,
} from "./avatar-image";
import { ConfirmDialog } from "./confirm-dialog";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { useAction } from "./use-action";
import { UserAvatar } from "./user-avatar";

const WEBP_QUALITY = 0.85;

/** Thrown when the browser cannot decode or re-encode the chosen picture. */
class ImageProcessingError extends Error {
  constructor(reason: string) {
    super(`Could not process image: ${reason}`);
    this.name = "ImageProcessingError";
  }
}

/**
 * Error shown to the user when the picture cannot be read; useAction toasts its message,
 * so it is written in Portuguese and keeps the technical reason as the cause.
 */
class UnreadableImageError extends Error {
  constructor(cause: unknown) {
    super("Não foi possível ler esta imagem. Tente outra foto.", { cause });
    this.name = "UnreadableImageError";
  }
}

/**
 * Crops the picture to a centered square and re-encodes it at the avatar size, so any photo
 * becomes a small WebP (PNG on browsers without WebP encoding).
 */
async function toAvatarBytes(file: File): Promise<Uint8Array> {
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

function uploadLabel(uploading: boolean, hasPhoto: boolean): string {
  if (uploading) {
    return "Enviando…";
  }
  return hasPhoto ? "Trocar imagem" : "Escolher imagem";
}

/** Dialog where the signed-in user picks or removes their profile photo. */
export function ProfilePhotoDialog({
  user,
  open,
  onOpenChange,
}: {
  readonly user: { readonly name: string; readonly image: string | null };
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const refreshSession = async () => {
    await router.invalidate();
  };
  const upload = useAction({
    action: async (file: File) => {
      const bytes = await toAvatarBytes(file).catch((error: unknown) => {
        throw new UnreadableImageError(error);
      });
      return await updateAvatarFn({ data: { imageBase64: bytesToBase64(bytes) } });
    },
    successMessage: "Foto de perfil atualizada",
    onSuccess: refreshSession,
  });
  const remove = useAction({
    action: () => removeAvatarFn(),
    successMessage: "Foto de perfil removida",
    onSuccess: refreshSession,
  });
  const busy = upload.isPending || remove.isPending;

  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Clearing the input lets the same file be picked again after an error.
    if (inputRef.current != null) {
      inputRef.current.value = "";
    }
    if (file == null) {
      return;
    }
    if (file.type.startsWith("image/") === false) {
      toast.error("Escolha um arquivo de imagem.");
      return;
    }
    if (file.size > MAX_SOURCE_IMAGE_BYTES) {
      toast.error("A imagem passa de 20 MB. Escolha uma foto menor.");
      return;
    }
    upload.mutate(file);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Foto de perfil</DialogTitle>
          <DialogDescription>
            A foto é recortada em quadrado e reduzida automaticamente. Aparece no menu da conta e na
            lista de usuários.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-5 py-2">
          <UserAvatar
            name={user.name}
            image={user.image}
            className="size-28"
            fallbackClassName="text-2xl"
          />
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={pick}
          />
          <div className="flex flex-wrap justify-center gap-2">
            <Button disabled={busy} onClick={() => inputRef.current?.click()}>
              {upload.isPending ? (
                <LoaderCircleIcon aria-hidden className="animate-spin" />
              ) : (
                <ImageUpIcon aria-hidden />
              )}
              {uploadLabel(upload.isPending, user.image != null)}
            </Button>
            {user.image == null ? null : (
              <ConfirmDialog
                trigger={
                  <Button variant="outline" disabled={busy}>
                    {remove.isPending ? (
                      <LoaderCircleIcon aria-hidden className="animate-spin" />
                    ) : (
                      <Trash2Icon aria-hidden />
                    )}
                    Remover foto
                  </Button>
                }
                title="Remover a foto de perfil?"
                description="No lugar dela aparecem as iniciais do seu nome."
                confirmLabel="Remover"
                destructive
                onConfirm={() => remove.mutate()}
              />
            )}
          </div>
          <p className="text-xs text-muted-foreground">JPG, PNG ou WebP de até 20 MB.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
