import { useForm } from "@tanstack/react-form";
import type { z } from "zod";

import type { Role } from "@/shared/roles";
import { newUserSchema } from "@/shared/schemas/user.schema";
import { useAction } from "@/web/components/layout/use-action";
import { createUserFn } from "@/web/functions/settings.functions";

type NewUserForm = { name: string; email: string; role: Role; password: string };

const EMPTY_USER: NewUserForm = { name: "", email: "", role: "developer", password: "" };

/** Form state of a new account and the action that creates it. */
export function useCreateUserForm(onCreated: () => void) {
  const create = useAction({
    action: (data: z.output<typeof newUserSchema>) => createUserFn({ data }),
    successMessage: "Usuário criado. Envie a senha por um canal seguro.",
    invalidate: [["users"]],
    onSuccess: onCreated,
  });
  const form = useForm({
    defaultValues: EMPTY_USER,
    validators: { onChange: newUserSchema },
    onSubmit: ({ value }) => create.mutate(newUserSchema.parse(value)),
  });
  return { form, isPending: create.isPending };
}

export type CreateUserFormApi = ReturnType<typeof useCreateUserForm>["form"];
