import { Building2Icon, LoaderCircleIcon, TriangleAlertIcon } from "lucide-react";

import type { SystemSettings } from "@/shared/schemas/settings.schema";
import { Section } from "@/web/components/layout/layout";
import { Button } from "@/web/components/ui/button";
import { Card } from "@/web/components/ui/card";

import { AutomaticDomainFields, OrganizationNameField } from "./organization-fields";
import { type OrganizationFormApi, useOrganizationForm } from "./use-organization-form";

function SaveSettingsBar({
  form,
  isPending,
}: {
  readonly form: OrganizationFormApi;
  readonly isPending: boolean;
}) {
  return (
    <form.Subscribe selector={(state) => state.isDefaultValue === false}>
      {(changed) => (
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={isPending || changed === false}>
            {isPending ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
            Salvar
          </Button>
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
    <Section
      icon={Building2Icon}
      title="Organização"
      description="Preferências que valem para todos os projetos."
    >
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
          {traefikEnabled ? null : (
            <p role="status" className="flex items-start gap-1.5 text-sm text-warning">
              <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />O Traefik está
              desativado neste servidor: domínios automáticos e HTTPS não são aplicados.
            </p>
          )}
          {canEdit ? (
            <SaveSettingsBar form={form} isPending={isPending} />
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
