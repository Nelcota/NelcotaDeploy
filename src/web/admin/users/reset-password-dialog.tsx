import { useForm } from "@tanstack/react-form";
import { LockKeyholeIcon } from "lucide-react";
import { useState } from "react";
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
import { generateAccountPassword } from "./credentials/account-defaults";
import { CredentialReceipt } from "./credentials/credential-receipt";
import { PasswordInput } from "./password-input";

const resetPasswordSchema = z.object({ password: passwordSchema });

function useResetPasswordForm(userId: string) {
  const [initialPassword] = useState(generateAccountPassword);
  const [savedPassword, setSavedPassword] = useState<string | null>(null);
  const reset = useAction({
    action: async (password: string) => {
      await resetUserPasswordFn({ data: { userId, password } });
      setSavedPassword(password);
    },
    successMessage: "Senha redefinida. As sessões do usuário foram encerradas.",
  });
  const form = useForm({
    defaultValues: { password: initialPassword },
    validators: { onChange: resetPasswordSchema },
    onSubmit: ({ value }) => reset.mutate(value.password),
  });
  return { form, isPending: reset.isPending, savedPassword };
}

/** Dialog that sets a new password for an account and ends its sessions. */
export function ResetPasswordDialog({
  user,
  onClose,
}: {
  readonly user: { readonly id: string; readonly name: string; readonly email: string };
  readonly onClose: () => void;
}) {
  const { form, isPending, savedPassword } = useResetPasswordForm(user.id);
  if (savedPassword != null) {
    return (
      <CredentialReceipt
        title="Senha redefinida"
        credentials={{ name: user.name, email: user.email, password: savedPassword }}
        onClose={onClose}
      />
    );
  }
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
        <DialogHeader icon={<LockKeyholeIcon />}>
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
          <fieldset disabled={isPending}>
            <form.Field name="password">
              {(field) => (
                <FormField
                  id="reset-password"
                  label="Nova senha"
                  hint={`Senha forte gerada automaticamente. Mínimo de ${PASSWORD_MIN_LENGTH} caracteres. A senha atual só muda ao confirmar.`}
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
          </fieldset>
          <DialogFormFooter
            submitLabel="Redefinir senha e encerrar sessões"
            isPending={isPending}
            onCancel={() => {
              if (isPending === false) {
                onClose();
              }
            }}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
