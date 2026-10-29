import { useForm } from "@tanstack/react-form";
import { z } from "zod";

import { PASSWORD_MIN_LENGTH, passwordSchema } from "@/shared/schemas/user.schema";
import { FormField, visibleErrors } from "@/web/components/forms/form-field";
import { useAction } from "@/web/components/layout/use-action";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";
import { resetUserPasswordFn } from "@/web/functions/admin/users.functions";

import { DialogFormFooter } from "../dialog-form-footer";
import { PasswordInput } from "./password-input";

const resetPasswordSchema = z.object({ password: passwordSchema });

function useResetPasswordForm(userId: string, onDone: () => void) {
  const reset = useAction({
    action: (password: string) => resetUserPasswordFn({ data: { userId, password } }),
    successMessage: "Senha redefinida. As sessões do usuário foram encerradas.",
    onSuccess: onDone,
  });
  const form = useForm({
    defaultValues: { password: "" },
    validators: { onChange: resetPasswordSchema },
    onSubmit: ({ value }) => reset.mutate(value.password),
  });
  return { form, isPending: reset.isPending };
}

/** Dialog that sets a new password for an account and ends its sessions. */
export function ResetPasswordDialog({
  user,
  onClose,
}: {
  readonly user: { readonly id: string; readonly name: string };
  readonly onClose: () => void;
}) {
  const { form, isPending } = useResetPasswordForm(user.id, onClose);
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Redefinir senha de {user.name}</DialogTitle>
          <DialogDescription>As sessões abertas desse usuário serão encerradas.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.Field name="password">
            {(field) => (
              <FormField
                id="reset-password"
                label="Nova senha"
                hint={`Mínimo de ${PASSWORD_MIN_LENGTH} caracteres.`}
                errors={visibleErrors(form, field.state.meta)}
              >
                {(props) => (
                  <PasswordInput
                    props={props}
                    value={field.state.value}
                    onChange={field.handleChange}
                  />
                )}
              </FormField>
            )}
          </form.Field>
          <DialogFormFooter submitLabel="Redefinir" isPending={isPending} onCancel={onClose} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
