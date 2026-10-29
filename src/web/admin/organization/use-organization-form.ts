import { useForm } from "@tanstack/react-form";
import type { z } from "zod";

import { type SystemSettings, systemSettingsSchema } from "@/shared/schemas/settings.schema";
import { useAction } from "@/web/components/layout/use-action";
import { saveSettingsFn } from "@/web/functions/settings.functions";

/** Form state of the organization settings and the action that saves them. */
export function useOrganizationForm(initial: SystemSettings) {
  const save = useAction({
    action: (data: z.input<typeof systemSettingsSchema>) => saveSettingsFn({ data }),
    successMessage: "Configurações salvas",
    invalidate: [["settings"], ["project"]],
  });
  const form = useForm({
    defaultValues: {
      organizationName: initial.organizationName,
      baseDomain: initial.baseDomain ?? "",
      httpsByDefault: initial.httpsByDefault,
    },
    validators: { onChange: systemSettingsSchema },
    onSubmit: ({ value }) => save.mutate(value),
  });
  return { form, isPending: save.isPending };
}

export type OrganizationFormApi = ReturnType<typeof useOrganizationForm>["form"];
