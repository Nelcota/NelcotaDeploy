import { Building2Icon, LoaderCircleIcon, TriangleAlertIcon } from "lucide-react";

import type { SystemSettings } from "@/shared/schemas/settings.schema";
import { Section } from "@/web/components/layout/layout";
import { useAction } from "@/web/components/layout/use-action";
import { Button } from "@/web/components/ui/button";
import { Card } from "@/web/components/ui/card";
import { sendTestAlertFn } from "@/web/functions/admin/settings.functions";

import {
  AlertWebhookField,
  AutomaticDomainFields,
  OrganizationNameField,
} from "./organization-fields";
import { type OrganizationFormApi, useOrganizationForm } from "./use-organization-form";

function TestAlertButton() {
  const test = useAction({
    action: () => sendTestAlertFn(),
    successMessage: "Alerta de teste enviado",
  });
  return (
    <Button type="button" variant="outline" disabled={test.isPending} onClick={() => test.mutate()}>
      Enviar alerta de teste
    </Button>
  );
}

function SaveSettingsBar({
  form,
  isPending,
  canTestAlerts,
}: {
  readonly form: OrganizationFormApi;
  readonly isPending: boolean;
  /** A saved webhook can be tested; an unsaved one would test the old address. */
  readonly canTestAlerts: boolean;
}) {
  return (
    <form.Subscribe selector={(state) => state.isDefaultValue === false}>
      {(changed) => (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={isPending || changed === false}>
            {isPending ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
            Salvar
          </Button>
          {canTestAlerts && changed === false ? <TestAlertButton /> : null}
          {changed ? (
            <span className="text-sm text-muted-foreground">Alterações não salvas</span>
          ) : null}
        </div>
      )}
    </form.Subscribe>
  );
}

/** Organization settings form; read-only for non-admins. */
export function OrganizationForm({
  initial,
  canEdit,
  traefikEnabled,
}: {
  readonly initial: SystemSettings;
  readonly canEdit: boolean;
  /** Without the proxy, automatic domains and HTTPS are never applied. */
  readonly traefikEnabled: boolean;
}) {
  const { form, isPending } = useOrganizationForm(initial);
  return (
    <Section icon={Building2Icon} title="Organização">
      <Card className="p-5">
        <form
          noValidate
          className="max-w-lg space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <OrganizationNameField form={form} canEdit={canEdit} />
          <AutomaticDomainFields form={form} canEdit={canEdit} />
          <AlertWebhookField form={form} canEdit={canEdit} />
          {traefikEnabled ? null : (
            <p role="status" className="flex items-start gap-1.5 text-sm text-warning">
              <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />O Traefik está
              desativado neste servidor: domínios automáticos e HTTPS não são aplicados.
            </p>
          )}
          {canEdit ? (
            <SaveSettingsBar
              form={form}
              isPending={isPending}
              canTestAlerts={initial.alertWebhookUrl != null}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Somente administradores podem alterar estas configurações.
            </p>
          )}
        </form>
      </Card>
    </Section>
  );
}
