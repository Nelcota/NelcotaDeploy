import { useForm } from "@tanstack/react-form";
import { useBlocker } from "@tanstack/react-router";
import { toast } from "sonner";
import type { z } from "zod";

import { type SystemSettings, systemSettingsSchema } from "@/shared/schemas/settings.schema";
import type { OrganizationSettingsSection } from "@/shared/schemas/settings/organization-settings.schema";
import { useAction } from "@/web/components/layout/use-action";
import { saveSettingsFn } from "@/web/functions/admin/settings.functions";

/** Form state of the organization settings and the action that saves them. */
export function useOrganizationForm(initial: SystemSettings, section: OrganizationSettingsSection) {
  const save = useAction({
    action: async (settings: z.input<typeof systemSettingsSchema>) =>
      await saveSettingsFn({ data: { section, settings } }),
    successMessage: "Configurações salvas",
    invalidate: [["settings"], ["project"]],
    onSuccess: (saved) =>
      form.reset({
        organizationName: saved.organizationName,
        baseDomain: saved.baseDomain ?? "",
        httpsByDefault: saved.httpsByDefault,
        alertWebhookUrl: saved.alertWebhookUrl ?? "",
      }),
  });
  const form = useForm({
    defaultValues: {
      organizationName: initial.organizationName,
      baseDomain: initial.baseDomain ?? "",
      httpsByDefault: initial.httpsByDefault,
      alertWebhookUrl: initial.alertWebhookUrl ?? "",
    },
    validators: { onChange: systemSettingsSchema },
    onSubmit: ({ value }) => save.mutate(value),
  });
  useBlocker({
    shouldBlockFn: () => {
      if (save.isPending) {
        toast.info("Aguarde o salvamento antes de sair desta página.");
        return true;
      }
      return (
        form.state.isDefaultValue === false &&
        window.confirm("Descartar as alterações não salvas e sair desta página?") === false
      );
    },
    enableBeforeUnload: () => form.state.isDefaultValue === false || save.isPending,
  });
  return { form, isPending: save.isPending };
}

export type OrganizationFormApi = ReturnType<typeof useOrganizationForm>["form"];
