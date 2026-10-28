import { LoaderCircleIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { z } from "zod";

import { type SystemSettings, systemSettingsSchema } from "@/shared/settings.schema";
import { FormField } from "@/web/components/form-field";
import { Section } from "@/web/components/layout";
import { ErrorState, ListSkeleton } from "@/web/components/states";
import { Button } from "@/web/components/ui/button";
import { Card } from "@/web/components/ui/card";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";
import { Switch } from "@/web/components/ui/switch";
import { useAction } from "@/web/components/use-action";
import { saveSettingsFn } from "@/web/functions/settings.functions";

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
  return <OrganizationForm initial={settings.data.settings} canEdit={canEdit} />;
}

function OrganizationForm({
  initial,
  canEdit,
}: {
  readonly initial: SystemSettings;
  readonly canEdit: boolean;
}) {
  const [organizationName, setOrganizationName] = useState(initial.organizationName);
  const [baseDomain, setBaseDomain] = useState(initial.baseDomain ?? "");
  const [httpsByDefault, setHttpsByDefault] = useState(initial.httpsByDefault);
  const [errors, setErrors] = useState<{ organizationName?: string[]; baseDomain?: string[] }>({});
  const save = useAction({
    action: (data: z.input<typeof systemSettingsSchema>) => saveSettingsFn({ data }),
    successMessage: "Configurações salvas",
    invalidate: [["settings"], ["project"]],
  });

  const changed =
    organizationName !== initial.organizationName ||
    baseDomain !== (initial.baseDomain ?? "") ||
    httpsByDefault !== initial.httpsByDefault;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = systemSettingsSchema.safeParse({ organizationName, baseDomain, httpsByDefault });
    if (parsed.success === false) {
      setErrors(z.flattenError(parsed.error).fieldErrors);
      return;
    }
    setErrors({});
    save.mutate({ organizationName, baseDomain, httpsByDefault });
  };

  return (
    <Section title="Organização" description="Preferências que valem para todos os projetos.">
      <Card className="p-5">
        <form className="max-w-lg space-y-4" onSubmit={submit}>
          <FormField
            id="organization-name"
            label="Nome da organização"
            errors={errors.organizationName ?? []}
          >
            {(props) => (
              <Input
                {...props}
                disabled={canEdit === false}
                value={organizationName}
                onChange={(event) => setOrganizationName(event.target.value)}
              />
            )}
          </FormField>
          <FormField
            id="base-domain"
            label="Domínio base"
            hint="Com um domínio base, cada projeto recebe automaticamente o endereço <slug>.<domínio base>. Aponte um DNS curinga (*.apps.exemplo.com) para este servidor."
            errors={errors.baseDomain ?? []}
          >
            {(props) => (
              <Input
                {...props}
                className="font-mono"
                placeholder="apps.exemplo.com"
                disabled={canEdit === false}
                value={baseDomain}
                onChange={(event) => setBaseDomain(event.target.value)}
              />
            )}
          </FormField>
          <div className="flex items-start gap-3">
            <Switch
              id="https-default"
              disabled={canEdit === false}
              checked={httpsByDefault}
              onCheckedChange={setHttpsByDefault}
              aria-describedby="https-default-hint"
            />
            <div className="space-y-1">
              <Label htmlFor="https-default">HTTPS nos domínios automáticos</Label>
              <p id="https-default-hint" className="text-xs text-muted-foreground">
                O Traefik emite um certificado Let&apos;s Encrypt para cada domínio
                &lt;identificador&gt;.&lt;domínio base&gt;.
              </p>
            </div>
          </div>
          {canEdit ? (
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={save.isPending || changed === false}>
                {save.isPending ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
                Salvar
              </Button>
              {changed ? (
                <span className="text-sm text-muted-foreground">Alterações não salvas</span>
              ) : null}
            </div>
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
