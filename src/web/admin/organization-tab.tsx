import { useForm } from "@tanstack/react-form";
import { Building2Icon, LoaderCircleIcon, TriangleAlertIcon } from "lucide-react";
import type { z } from "zod";

import { type SystemSettings, systemSettingsSchema } from "@/shared/settings.schema";
import { FormField, visibleErrors } from "@/web/components/forms/form-field";
import { Section } from "@/web/components/layout/layout";
import { ErrorState, ListSkeleton } from "@/web/components/layout/states";
import { useAction } from "@/web/components/layout/use-action";
import { Button } from "@/web/components/ui/button";
import { Card } from "@/web/components/ui/card";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";
import { Switch } from "@/web/components/ui/switch";
import { saveSettingsFn } from "@/web/functions/settings.functions";

import { exampleDomainOf } from "./example-domain";
import { useSettings } from "./use-settings";

/** Organization name, base domain and HTTPS default, editable by admins. */
export function OrganizationTab({ canEdit }: { readonly canEdit: boolean }) {
  const settings = useSettings();
  if (settings.isError) {
    return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;
  }
  if (settings.data == null) {
    return <ListSkeleton rows={3} />;
  }
  return (
    <OrganizationForm
      // A new key after saving resets the form to the saved values, so "changed" clears.
      key={JSON.stringify(settings.data.settings)}
      initial={settings.data.settings}
      canEdit={canEdit}
      traefikEnabled={settings.data.server.traefikEnabled}
    />
  );
}

function OrganizationForm({
  initial,
  canEdit,
  traefikEnabled,
}: {
  readonly initial: SystemSettings;
  readonly canEdit: boolean;
  /** Without the proxy, automatic domains and HTTPS are never applied. */
  readonly traefikEnabled: boolean;
}) {
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
          <form.Field name="organizationName">
            {(field) => (
              <FormField
                id="organization-name"
                label="Nome da organização"
                errors={visibleErrors(form, field.state.meta)}
              >
                {(props) => (
                  <Input
                    {...props}
                    disabled={canEdit === false}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                )}
              </FormField>
            )}
          </form.Field>
          <form.Subscribe selector={(state) => exampleDomainOf(state.values.baseDomain)}>
            {(exampleDomain) => (
              <>
                <form.Field name="baseDomain">
                  {(field) => (
                    <FormField
                      id="base-domain"
                      label="Domínio base"
                      hint={`Cada projeto recebe o endereço <identificador>.${exampleDomain}. Aponte um DNS curinga (*.${exampleDomain}) para este servidor.`}
                      errors={visibleErrors(form, field.state.meta)}
                    >
                      {(props) => (
                        <Input
                          {...props}
                          className="font-mono"
                          placeholder="apps.exemplo.com"
                          disabled={canEdit === false}
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(event) => field.handleChange(event.target.value)}
                        />
                      )}
                    </FormField>
                  )}
                </form.Field>
                <form.Field name="httpsByDefault">
                  {(field) => (
                    <div className="flex items-start gap-3">
                      <Switch
                        id="https-default"
                        disabled={canEdit === false}
                        checked={field.state.value}
                        onCheckedChange={field.handleChange}
                        aria-describedby="https-default-hint"
                      />
                      <div className="space-y-1">
                        <Label htmlFor="https-default">HTTPS nos domínios automáticos</Label>
                        <p id="https-default-hint" className="text-xs text-muted-foreground">
                          O Traefik emite um certificado Let&apos;s Encrypt para cada domínio
                          &lt;identificador&gt;.{exampleDomain}.
                        </p>
                      </div>
                    </div>
                  )}
                </form.Field>
              </>
            )}
          </form.Subscribe>
          {traefikEnabled ? null : (
            <p role="status" className="flex items-start gap-1.5 text-sm text-warning">
              <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />O Traefik está
              desativado neste servidor: domínios automáticos e HTTPS não são aplicados.
            </p>
          )}
          {canEdit ? (
            <form.Subscribe selector={(state) => state.isDefaultValue === false}>
              {(changed) => (
                <div className="flex items-center gap-3">
                  <Button type="submit" disabled={save.isPending || changed === false}>
                    {save.isPending ? (
                      <LoaderCircleIcon aria-hidden className="animate-spin" />
                    ) : null}
                    Salvar
                  </Button>
                  {changed ? (
                    <span className="text-sm text-muted-foreground">Alterações não salvas</span>
                  ) : null}
                </div>
              )}
            </form.Subscribe>
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
