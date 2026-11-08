import { useForm } from "@tanstack/react-form";
import { useRef, useState } from "react";
import type { z } from "zod";

import type { Role } from "@/shared/roles";
import { newUserSchema } from "@/shared/schemas/user.schema";
import { useAction } from "@/web/components/layout/use-action";
import { createUserFn } from "@/web/functions/admin/users.functions";

import {
  type AccountCredentials,
  generateAccountPassword,
  parseAccountAddress,
} from "./credentials/account-defaults";

type NewUserForm = { name: string; email: string; role: Role; password: string };

const EMPTY_USER: NewUserForm = { name: "", email: "", role: "developer", password: "" };

/** Form state of a new account and the action that creates it. */
export function useCreateUserForm() {
  const [initialPassword] = useState(generateAccountPassword);
  const [credentials, setCredentials] = useState<AccountCredentials | null>(null);
  const manualName = useRef(false);
  const detectedEmail = useRef<string | null>(null);
  const create = useAction({
    action: async (data: z.output<typeof newUserSchema>) => {
      await createUserFn({ data });
      setCredentials({ name: data.name, email: data.email, password: data.password });
    },
    successMessage: "Usuário criado. Guarde as credenciais exibidas.",
    invalidate: [["users"]],
  });
  const form = useForm({
    defaultValues: { ...EMPTY_USER, password: initialPassword },
    validators: { onChange: newUserSchema },
    onSubmit: ({ value }) => create.mutate(newUserSchema.parse(value)),
  });
  const detectIdentity = (value: string): boolean => {
    const address = parseAccountAddress(value);
    if (address == null) {
      return false;
    }
    form.setFieldValue("email", address.email);
    if (
      manualName.current === false &&
      (address.name != null || detectedEmail.current !== address.email)
    ) {
      form.setFieldValue("name", address.name ?? "");
    }
    detectedEmail.current = address.email;
    return true;
  };
  return {
    form,
    isPending: create.isPending,
    credentials,
    detectIdentity,
    markNameEdited: () => {
      manualName.current = true;
    },
  };
}

export type CreateUserFormApi = ReturnType<typeof useCreateUserForm>["form"];
