import { useForm } from "@tanstack/react-form";
import { z } from "zod";

import { DEFAULT_SERVER_USERNAME, serverInputSchema } from "@/shared/schemas/server.schema";
import { useAction } from "@/web/components/layout/use-action";
import { addServerFn } from "@/web/functions/admin/servers.functions";

const DEFAULT_SSH_PORT = "22";
const MAX_PORT = 65_535;
const PORT_PATTERN = /^\d{1,5}$/;

const addServerFormSchema = z.object({
  name: serverInputSchema.shape.name,
  host: serverInputSchema.shape.host,
  port: z
    .string()
    .trim()
    .refine((port) => PORT_PATTERN.test(port) && Number(port) >= 1 && Number(port) <= MAX_PORT, {
      message: `Informe uma porta entre 1 e ${MAX_PORT}`,
    }),
  username: serverInputSchema.shape.username,
});

type AddServerForm = z.input<typeof addServerFormSchema>;

const EMPTY_SERVER: AddServerForm = {
  name: "",
  host: "",
  port: DEFAULT_SSH_PORT,
  username: DEFAULT_SERVER_USERNAME,
};

/** Form state of a new server and the action that registers it. */
export function useAddServerForm(onAdded: () => void) {
  const add = useAction({
    action: (data: z.input<typeof serverInputSchema>) => addServerFn({ data }),
    successMessage: "Servidor adicionado. Rode o comando de instalação nele.",
    invalidate: [["servers"]],
    onSuccess: onAdded,
  });
  const form = useForm({
    defaultValues: EMPTY_SERVER,
    validators: { onChange: addServerFormSchema },
    onSubmit: ({ value }) => {
      const parsed = addServerFormSchema.parse(value);
      add.mutate({ ...parsed, port: Number(parsed.port) });
    },
  });
  return { form, isPending: add.isPending };
}

export type AddServerFormApi = ReturnType<typeof useAddServerForm>["form"];
