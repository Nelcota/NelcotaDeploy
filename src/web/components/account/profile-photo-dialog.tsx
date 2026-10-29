import { useRouter } from "@tanstack/react-router";

import { toAvatarBytes } from "@/web/components/account/avatar-encoder";
import { bytesToBase64 } from "@/web/components/account/avatar-image";
import { PickPhotoButton, RemovePhotoButton } from "@/web/components/account/profile-photo-buttons";
import { UnreadableImageError } from "@/web/components/account/profile-photo.errors";
import { UserAvatar } from "@/web/components/account/user-avatar";
import { useAction } from "@/web/components/layout/use-action";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";
import { removeAvatarFn, updateAvatarFn } from "@/web/functions/session.functions";

function useProfilePhotoActions() {
  const router = useRouter();
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
  return { upload, remove };
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
  const { upload, remove } = useProfilePhotoActions();
  const busy = upload.isPending || remove.isPending;

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
          <div className="flex flex-wrap justify-center gap-2">
            <PickPhotoButton
              hasPhoto={user.image != null}
              uploading={upload.isPending}
              disabled={busy}
              onPick={(file) => upload.mutate(file)}
            />
            {user.image == null ? null : (
              <RemovePhotoButton
                removing={remove.isPending}
                disabled={busy}
                onRemove={() => remove.mutate()}
              />
            )}
          </div>
          <p className="text-xs text-muted-foreground">JPG, PNG ou WebP de até 20 MB.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
