import { UserPlusIcon } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";

import { DialogFormFooter } from "../dialog-form-footer";
import { AccessFields, IdentityFields } from "./create-user-fields";
import { CredentialReceipt } from "./credentials/credential-receipt";
import { useCreateUserForm } from "./use-create-user-form";

/** Dialog that creates an account; only admins reach it. */
export function CreateUserDialog({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const { form, isPending, credentials, detectIdentity, markNameEdited } = useCreateUserForm();
  if (credentials != null) {
    return (
      <CredentialReceipt
        credentials={credentials}
        title="Usuário criado"
        onClose={() => onOpenChange(false)}
      />
    );
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (isPending === false) {
          onOpenChange(next);
        }
      }}
    >
      <DialogContent>
        <DialogHeader icon={<UserPlusIcon />}>
          <DialogTitle>Novo usuário</DialogTitle>
          <DialogDescription>
            Não há cadastro público: só administradores criam contas.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            detectIdentity(form.getFieldValue("email"));
            void form.handleSubmit();
          }}
        >
          <fieldset disabled={isPending} className="space-y-4">
            <IdentityFields
              form={form}
              detectIdentity={detectIdentity}
              onNameEdited={markNameEdited}
            />
            <AccessFields form={form} />
          </fieldset>
          <DialogFormFooter
            submitLabel="Criar usuário"
            isPending={isPending}
            onCancel={() => {
              if (isPending === false) {
                onOpenChange(false);
              }
            }}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
