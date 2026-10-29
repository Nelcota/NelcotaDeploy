import { FormField, visibleErrors } from "@/web/components/forms/form-field";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";
import { Switch } from "@/web/components/ui/switch";

import { exampleDomainOf } from "./example-domain";
import type { OrganizationFormApi } from "./use-organization-form";

type FieldsProps = { readonly form: OrganizationFormApi; readonly canEdit: boolean };

/** Name of the organization shown across the panel. */
export function OrganizationNameField({ form, canEdit }: FieldsProps) {
  return (
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
  );
}

function BaseDomainField({
  form,
  canEdit,
  exampleDomain,
}: FieldsProps & { readonly exampleDomain: string }) {
  return (
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
  );
}

function HttpsByDefaultField({
  form,
  canEdit,
  exampleDomain,
}: FieldsProps & { readonly exampleDomain: string }) {
  return (
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
  );
}

/** Base domain of automatic addresses and whether they get HTTPS. */
export function AutomaticDomainFields({ form, canEdit }: FieldsProps) {
  return (
    <form.Subscribe selector={(state) => exampleDomainOf(state.values.baseDomain)}>
      {(exampleDomain) => (
        <>
          <BaseDomainField form={form} canEdit={canEdit} exampleDomain={exampleDomain} />
          <HttpsByDefaultField form={form} canEdit={canEdit} exampleDomain={exampleDomain} />
        </>
      )}
    </form.Subscribe>
  );
}
