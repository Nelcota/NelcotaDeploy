import { KeyRoundIcon, ShieldPlusIcon } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";

import { DialogFormFooter } from "../dialog-form-footer";
import { TokenExpiryField, TokenNameField, TokenScopesField } from "./create-token-fields";
import { useCreateTokenForm } from "./use-create-token-form";

/** Dialog that creates an API token and hands the secret value to `onCreated`. */
export function CreateTokenDialog({
  onClose,
  onCreated,
}: {
  readonly onClose: () => void;
  readonly onCreated: (token: string) => void;
}) {
  const { form, isPending } = useCreateTokenForm(onCreated);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (open === false && isPending === false) {
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader icon={<KeyRoundIcon />}>
          <DialogTitle>Novo token de API</DialogTitle>
          <DialogDescription>
            O token é exibido uma única vez, logo após a criação.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (isPending === false) {
              void form.handleSubmit();
            }
          }}
        >
          <fieldset disabled={isPending} className="space-y-4">
            <TokenNameField form={form} />
            <TokenScopesField form={form} />
            <TokenExpiryField form={form} />
          </fieldset>
          <DialogFormFooter
            submitLabel="Criar token de API"
            isPending={isPending}
            onCancel={onClose}
            idleIcon={<ShieldPlusIcon aria-hidden />}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
