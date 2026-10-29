import { useForm } from "@tanstack/react-form";
import type { z } from "zod";

import { domainInputSchema } from "@/shared/schemas/domain.schema";
import { useAction } from "@/web/components/layout/use-action";
import { addDomainFn } from "@/web/functions/domains.functions";

/** Form state of a new domain, cleared after it is added. */
export function useAddDomainForm(projectId: string) {
  const add = useAction({
    action: (domain: z.output<typeof domainInputSchema>) =>
      addDomainFn({ data: { projectId, domain } }),
    successMessage: "Domínio adicionado",
    invalidate: [
      ["project", projectId],
      ["domains-dns", projectId],
    ],
    onSuccess: () => form.reset(),
  });
  const form = useForm({
    defaultValues: { hostname: "", httpsEnabled: true },
    validators: { onChange: domainInputSchema },
    onSubmit: ({ value }) => add.mutate(domainInputSchema.parse(value)),
  });
  return { form, add };
}

export type AddDomainFormApi = ReturnType<typeof useAddDomainForm>["form"];
