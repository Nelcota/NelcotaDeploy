import { PASSWORD_MIN_LENGTH } from "@/shared/schemas/user.schema";
import { FormField, visibleErrors } from "@/web/components/forms/form-field";
import { Input } from "@/web/components/ui/input";

import { PasswordInput } from "./password-input";
import type { CreateUserFormApi } from "./use-create-user-form";
import { RoleSelect } from "./user-access-controls";

/** Name and e-mail of the new account. */
export function IdentityFields({ form }: { readonly form: CreateUserFormApi }) {
  return (
    <>
      <form.Field name="name">
        {(field) => (
          <FormField id="user-name" label="Nome" errors={visibleErrors(form, field.state.meta)}>
            {(props) => (
              <Input
                {...props}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            )}
          </FormField>
        )}
      </form.Field>
      <form.Field name="email">
        {(field) => (
          <FormField id="user-email" label="E-mail" errors={visibleErrors(form, field.state.meta)}>
            {(props) => (
              <Input
                {...props}
                type="email"
                autoComplete="off"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            )}
          </FormField>
        )}
      </form.Field>
    </>
  );
}

/** Role and initial password of the new account. */
export function AccessFields({ form }: { readonly form: CreateUserFormApi }) {
  return (
    <>
      <form.Field name="role">
        {(field) => (
          <FormField id="user-role" label="Papel">
            {(props) => (
              <RoleSelect
                value={field.state.value}
                onChange={field.handleChange}
                triggerProps={{ ...props, className: "w-full" }}
              />
            )}
          </FormField>
        )}
      </form.Field>
      <form.Field name="password">
        {(field) => (
          <FormField
            id="user-password"
            label="Senha inicial"
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
    </>
  );
}
