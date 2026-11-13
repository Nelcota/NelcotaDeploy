import type { ReactNode } from "react";

import type { ProjectFormApi } from "@/web/components/forms/project-form";
import { cn } from "@/web/components/ui/class-names";
import { Switch } from "@/web/components/ui/switch";

import { errorMessages, visibleErrors } from "./form-field";
import { PROJECT_FORM_FIELDS } from "./project-validation";

/** A bordered list of switches, one row each, divided by hairlines. */
export function SwitchGroup({ children }: { readonly children: ReactNode }) {
  return (
    <div className="divide-y divide-border/70 rounded-xl ring-1 ring-border/70 ring-inset">
      {children}
    </div>
  );
}

function SwitchRow({
  form,
  name,
  hint,
  className,
}: {
  readonly form: ProjectFormApi;
  readonly name: "autoDeploy" | "autoApplyChanges" | "autoRollback" | "previewsEnabled";
  readonly hint: string;
  readonly className?: string | undefined;
}) {
  const { id, label } = PROJECT_FORM_FIELDS[name];
  return (
    <form.Field name={name}>
      {(field) => {
        const [error] = errorMessages(visibleErrors(form, field.state.meta));
        return (
          <div className={cn("flex items-center justify-between gap-6 px-4 py-3.5", className)}>
            <div className="min-w-0 space-y-0.5">
              <label htmlFor={id} className="text-sm font-medium">
                {label}
              </label>
              <p id={`${id}-hint`} className="text-xs text-muted-foreground">
                {hint}
              </p>
              <p
                id={`${id}-error`}
                aria-live="polite"
                className="text-xs font-medium text-destructive empty:hidden"
              >
                {error}
              </p>
            </div>
            <Switch
              id={id}
              checked={field.state.value}
              onCheckedChange={(checked) => field.handleChange(checked)}
              onBlur={field.handleBlur}
              aria-invalid={error != null}
              aria-describedby={error == null ? `${id}-hint` : `${id}-hint ${id}-error`}
            />
          </div>
        );
      }}
    </form.Field>
  );
}

/** Switch that turns deploys on push on or off. */
export function AutoDeployField({
  form,
  className,
}: {
  readonly form: ProjectFormApi;
  readonly className?: string;
}) {
  return (
    <SwitchRow
      form={form}
      name="autoDeploy"
      hint="Faz deploy a cada push na branch, via webhook do GitHub."
      className={className}
    />
  );
}

/** Switch that rolls a new version back on its own when its containers keep restarting. */
export function AutoRollbackField({
  form,
  className,
}: {
  readonly form: ProjectFormApi;
  readonly className?: string;
}) {
  return (
    <SwitchRow
      form={form}
      name="autoRollback"
      hint="Se a versão nova reiniciar 3 vezes nos primeiros minutos depois do deploy, o painel volta para a anterior e avisa."
      className={className}
    />
  );
}

/** Switch that gives each pull request to the branch its own temporary deployment. */
export function PreviewsField({
  form,
  className,
}: {
  readonly form: ProjectFormApi;
  readonly className?: string;
}) {
  return (
    <SwitchRow
      form={form}
      name="previewsEnabled"
      hint="Cada PR para a branch ganha um endereço próprio, removido quando o PR fecha. PRs de forks nunca rodam."
      className={className}
    />
  );
}

/** Switch that recreates the live container whenever variables or domains change. */
export function AutoApplyField({
  form,
  className,
}: {
  readonly form: ProjectFormApi;
  readonly className?: string;
}) {
  return (
    <SwitchRow
      form={form}
      name="autoApplyChanges"
      hint="Recria o contêiner ao salvar variáveis, domínios ou volumes."
      className={className}
    />
  );
}
