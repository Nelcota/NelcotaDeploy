import { normalizeVariableKey } from "@/shared/dotenv";
import { VariableKindToggle } from "@/web/components/forms/env-kind-toggle";
import { FormField, visibleErrors } from "@/web/components/forms/form-field";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";
import { Switch } from "@/web/components/ui/switch";
import { Textarea } from "@/web/components/ui/textarea";

import { MASKED_VALUE } from "../variable-draft";
import type { VariableFormApi } from "./use-variable-form";

/** Variable name, upper-cased as it is typed; locked once the variable exists. */
export function KeyField({
  form,
  locked,
}: {
  readonly form: VariableFormApi;
  readonly locked: boolean;
}) {
  return (
    <form.Field name="key">
      {(field) => (
        <FormField id="variable-key" label="Nome" errors={visibleErrors(form, field.state.meta)}>
          {(props) => (
            <Input
              {...props}
              className="font-mono"
              autoComplete="off"
              disabled={locked}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(normalizeVariableKey(event.target.value))}
            />
          )}
        </FormField>
      )}
    </form.Field>
  );
}

/** Plain setting or secret. */
export function KindField({ form }: { readonly form: VariableFormApi }) {
  return (
    <form.Field name="kind">
      {(field) => (
        <FormField id="variable-kind" label="Tipo" errors={visibleErrors(form, field.state.meta)}>
          {(props) => (
            <VariableKindToggle
              id={props.id}
              describedBy={props["aria-describedby"]}
              value={field.state.value}
              onChange={field.handleChange}
            />
          )}
        </FormField>
      )}
    </form.Field>
  );
}

/** The value; a saved secret may be left blank to keep what is stored. */
export function ValueField({
  form,
  savedSecret,
}: {
  readonly form: VariableFormApi;
  readonly savedSecret: boolean;
}) {
  return (
    <form.Subscribe selector={(state) => savedSecret && state.values.kind === "secret"}>
      {(editingSecret) => (
        <form.Field name="value">
          {(field) => (
            <FormField
              id="variable-value"
              label="Valor"
              hint={editingSecret ? "Deixe em branco para manter o valor atual." : undefined}
              errors={visibleErrors(form, field.state.meta)}
            >
              {(props) => (
                <Textarea
                  {...props}
                  className="font-mono text-sm"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={editingSecret ? MASKED_VALUE : undefined}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              )}
            </FormField>
          )}
        </form.Field>
      )}
    </form.Subscribe>
  );
}

/** Whether the build also receives the variable as a Dockerfile ARG. */
export function BuildSwitch({ form }: { readonly form: VariableFormApi }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg bg-secondary p-3 ring-1 ring-border ring-inset">
      <div className="space-y-1">
        <Label htmlFor="variable-build">Disponível no build</Label>
        <p id="variable-build-hint" className="text-xs text-muted-foreground">
          Também entregue ao build da imagem (ARG no Dockerfile).
        </p>
      </div>
      <form.Field name="availableAtBuild">
        {(field) => (
          <Switch
            id="variable-build"
            aria-describedby="variable-build-hint"
            checked={field.state.value}
            onCheckedChange={field.handleChange}
          />
        )}
      </form.Field>
    </div>
  );
}
