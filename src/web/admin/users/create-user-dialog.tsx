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
import { useCreateUserForm } from "./use-create-user-form";

/** Dialog that creates an account; only admins reach it. */
export function CreateUserDialog({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const { form, isPending } = useCreateUserForm(() => onOpenChange(false));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            void form.handleSubmit();
          }}
        >
          <IdentityFields form={form} />
          <AccessFields form={form} />
          <DialogFormFooter
            submitLabel="Criar usuário"
            isPending={isPending}
            onCancel={() => onOpenChange(false)}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
