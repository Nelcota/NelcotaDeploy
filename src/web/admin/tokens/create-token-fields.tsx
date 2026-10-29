import { formatDate } from "@/shared/format";
import { useNow } from "@/web/components/clock/use-now";
import { errorMessages, FormField, visibleErrors } from "@/web/components/forms/form-field";
import { Checkbox } from "@/web/components/ui/checkbox";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";

import { SCOPES, type TokenScope, toggleScope } from "./token-scopes";
import { expiryFor } from "./token-state";
import { type CreateTokenFormApi, MAX_TOKEN_DAYS } from "./use-create-token-form";

/** Name that tells the tokens apart in the list. */
export function TokenNameField({ form }: { readonly form: CreateTokenFormApi }) {
  return (
    <form.Field name="name">
      {(field) => (
        <FormField id="token-name" label="Nome" errors={visibleErrors(form, field.state.meta)}>
          {(props) => (
            <Input
              {...props}
              placeholder="claude-code-notebook"
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

function ScopeCheckbox({
  scope,
  selected,
  onChange,
}: {
  readonly scope: (typeof SCOPES)[number];
  readonly selected: readonly TokenScope[];
  readonly onChange: (scopes: TokenScope[]) => void;
}) {
  const id = `token-scope-${scope.value}`;
  return (
    <div className="flex items-start gap-2.5">
      <Checkbox
        id={id}
        className="mt-0.5"
        checked={selected.includes(scope.value)}
        onCheckedChange={(checked) =>
          onChange(toggleScope(selected, scope.value, checked === true))
        }
        aria-describedby={`${id}-hint`}
      />
      <div className="space-y-0.5">
        <Label htmlFor={id}>{scope.label}</Label>
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {scope.description}
        </p>
      </div>
    </div>
  );
}

/** Checkboxes of the scopes the token is allowed to use. */
export function TokenScopesField({ form }: { readonly form: CreateTokenFormApi }) {
  return (
    <form.Field name="scopes">
      {(field) => {
        const [error] = errorMessages(
          form.state.submissionAttempts > 0 ? field.state.meta.errors : [],
        );
        return (
          <fieldset className="space-y-3" aria-describedby="token-scopes-error">
            <legend className="mb-2 text-sm font-medium">Escopos</legend>
            {SCOPES.map((scope) => (
              <ScopeCheckbox
                key={scope.value}
                scope={scope}
                selected={field.state.value}
                onChange={field.handleChange}
              />
            ))}
            <p
              id="token-scopes-error"
              aria-live="polite"
              className="text-xs font-medium text-destructive empty:hidden"
            >
              {error ?? ""}
            </p>
          </fieldset>
        );
      }}
    </form.Field>
  );
}

/** Validity in days, with a preview of the expiry date. */
export function TokenExpiryField({ form }: { readonly form: CreateTokenFormApi }) {
  const now = useNow();
  return (
    <form.Field name="expiresInDays">
      {(field) => {
        const expiry = expiryFor(field.state.value, now, MAX_TOKEN_DAYS);
        return (
          <FormField
            id="token-expiry"
            label="Validade em dias"
            hint={
              typeof expiry === "string"
                ? `Expira em ${formatDate(expiry)}.`
                : "Deixe em branco para não expirar (não recomendado)."
            }
            errors={visibleErrors(form, field.state.meta)}
          >
            {(props) => (
              <Input
                {...props}
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_TOKEN_DAYS}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            )}
          </FormField>
        );
      }}
    </form.Field>
  );
}
