import type { ProjectFormApi } from "@/web/components/forms/project-form";
import { cn } from "@/web/components/ui/class-names";
import { Switch } from "@/web/components/ui/switch";

function SwitchRow({
  form,
  name,
  label,
  hint,
  className,
}: {
  readonly form: ProjectFormApi;
  readonly name: "autoDeploy" | "autoApplyChanges" | "previewsEnabled";
  readonly label: string;
  readonly hint: string;
  readonly className?: string | undefined;
}) {
  const id = `project-${name}`;
  return (
    <form.Field name={name}>
      {(field) => (
        <div
          className={cn(
            "flex items-center justify-between gap-6 rounded-xl px-4 py-3.5 ring-1 ring-border/70 ring-inset",
            className,
          )}
        >
          <div className="min-w-0 space-y-0.5">
            <label htmlFor={id} className="text-sm font-medium">
              {label}
            </label>
            <p id={`${id}-hint`} className="text-xs text-muted-foreground">
              {hint}
            </p>
          </div>
          <Switch
            id={id}
            checked={field.state.value}
            onCheckedChange={(checked) => field.handleChange(checked)}
            aria-describedby={`${id}-hint`}
          />
        </div>
      )}
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
      label="Deploy automático"
      hint="Faz deploy a cada push na branch, via webhook do GitHub."
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
      label="Previews de pull request"
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
      label="Aplicar mudanças automaticamente"
      hint="Recria o contêiner ao salvar variáveis, domínios ou volumes."
      className={className}
    />
  );
}
