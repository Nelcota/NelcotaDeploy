import { ImageUpIcon, LoaderCircleIcon, Trash2Icon } from "lucide-react";
import { type ChangeEvent, useRef } from "react";
import { toast } from "sonner";

import { photoFileProblem } from "@/web/components/account/avatar-image";
import { ConfirmDialog } from "@/web/components/layout/confirm-dialog";
import { Button } from "@/web/components/ui/button";

function uploadLabel(uploading: boolean, hasPhoto: boolean): string {
  if (uploading) {
    return "Enviando…";
  }
  return hasPhoto ? "Trocar imagem" : "Escolher imagem";
}

type PickPhotoButtonProps = {
  readonly hasPhoto: boolean;
  readonly uploading: boolean;
  readonly disabled: boolean;
  readonly onPick: (file: File) => void;
};

/** Button that opens the file picker and hands a valid image to `onPick`. */
export function PickPhotoButton({ hasPhoto, uploading, disabled, onPick }: PickPhotoButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Clearing the input lets the same file be picked again after an error.
    if (inputRef.current != null) {
      inputRef.current.value = "";
    }
    if (file == null) {
      return;
    }
    const problem = photoFileProblem(file);
    if (problem != null) {
      toast.error(problem);
      return;
    }
    onPick(file);
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={pick}
      />
      <Button disabled={disabled} onClick={() => inputRef.current?.click()}>
        {uploading ? (
          <LoaderCircleIcon aria-hidden className="animate-spin" />
        ) : (
          <ImageUpIcon aria-hidden />
        )}
        {uploadLabel(uploading, hasPhoto)}
      </Button>
    </>
  );
}

/** Button that asks for confirmation before removing the profile photo. */
export function RemovePhotoButton({
  removing,
  disabled,
  onRemove,
}: {
  readonly removing: boolean;
  readonly disabled: boolean;
  readonly onRemove: () => void;
}) {
  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline" disabled={disabled}>
          {removing ? (
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
      onConfirm={onRemove}
    />
  );
}
