import type { ReactNode } from "react";

import { normalizeVariableKey } from "@/shared/dotenv";
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
              spellCheck={false}
              placeholder="DATABASE_URL"
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

/** The value; it grows with its content, and a saved secret may be left blank to keep it. */
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
                  rows={1}
                  // Starts at the height of the name input beside it and grows with the content.
                  className="max-h-48 min-h-11 py-2.5 font-mono text-sm"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={editingSecret ? MASKED_VALUE : "postgres://…"}
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

/** One option of the variable: a label and explanation with its switch on the right. */
function OptionRow({
  id,
  label,
  hint,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 px-4 py-3.5">
      <div className="min-w-0 space-y-0.5">
        <Label htmlFor={id}>{label}</Label>
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      </div>
      {children}
    </div>
  );
}

/** Whether the value is a secret, and whether the build receives it too. */
export function VariableOptions({ form }: { readonly form: VariableFormApi }) {
  return (
    <div className="divide-y divide-border/70 rounded-xl ring-1 ring-border/70 ring-inset">
      <OptionRow
        id="variable-secret"
        label="Secret"
        hint="Criptografado, nunca exibido de novo e mascarado nos logs."
      >
        <form.Field name="kind">
          {(field) => (
            <Switch
              id="variable-secret"
              aria-describedby="variable-secret-hint"
              checked={field.state.value === "secret"}
              onCheckedChange={(checked) => field.handleChange(checked ? "secret" : "plain")}
            />
          )}
        </form.Field>
      </OptionRow>
      <OptionRow
        id="variable-build"
        label="Disponível no build"
        hint="Também enviada ao build da imagem, como ARG no Dockerfile."
      >
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
      </OptionRow>
    </div>
  );
}
