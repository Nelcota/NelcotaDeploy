import { GitBranchIcon, HammerIcon, IdCardIcon, TriangleAlertIcon, ZapIcon } from "lucide-react";

import type { ProjectFormApi } from "@/web/components/forms/project-form";
import {
  BuildFields,
  HealthCheckField,
  IdentityFields,
  PortField,
  RepositoryFields,
} from "@/web/components/forms/project-form-fields";
import {
  AutoApplyField,
  AutoDeployField,
  PreviewsField,
  SwitchGroup,
} from "@/web/components/forms/project-switch-fields";

import { SettingsSection } from "./settings-section";

const FIELD_GRID = "grid items-start gap-x-6 gap-y-5 sm:grid-cols-2";

export function GeneralSection({ form }: { readonly form: ProjectFormApi }) {
  return (
    <SettingsSection
      icon={IdCardIcon}
      title="Geral"
      description="Como o projeto aparece no painel e no endereço automático."
    >
      <div className={FIELD_GRID}>
        <IdentityFields form={form} />
      </div>
    </SettingsSection>
  );
}

export function RepositorySection({
  form,
  savedRepositoryUrl,
}: {
  readonly form: ProjectFormApi;
  readonly savedRepositoryUrl: string;
}) {
  return (
    <SettingsSection
      icon={GitBranchIcon}
      title="Repositório"
      description="De onde vem o código. Precisa ter um Dockerfile."
    >
      <div className="grid items-start gap-x-6 gap-y-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)]">
        <RepositoryFields form={form} />
        <form.Subscribe selector={(state) => state.values.repositoryUrl !== savedRepositoryUrl}>
          {(repositoryChanged) => (repositoryChanged ? <ReapprovalWarning /> : null)}
        </form.Subscribe>
      </div>
    </SettingsSection>
  );
}

function ReapprovalWarning() {
  return (
    <p role="status" className="flex items-start gap-2 text-sm text-muted-foreground sm:col-span-2">
      <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
      Trocar o repositório exige nova aprovação de um administrador antes do próximo deploy.
    </p>
  );
}

export function BuildSection({ form }: { readonly form: ProjectFormApi }) {
  return (
    <SettingsSection
      icon={HammerIcon}
      title="Build e execução"
      description="Como a imagem é construída e como o painel sabe que a aplicação está no ar."
    >
      <div className={FIELD_GRID}>
        <PortField form={form} />
        <HealthCheckField form={form} />
        <BuildFields form={form} />
      </div>
    </SettingsSection>
  );
}

export function AutomationSection({ form }: { readonly form: ProjectFormApi }) {
  return (
    <SettingsSection icon={ZapIcon} title="Automação" description="O que o painel faz sozinho.">
      <SwitchGroup>
        <AutoDeployField form={form} />
        <AutoApplyField form={form} />
        <PreviewsField form={form} />
      </SwitchGroup>
    </SettingsSection>
  );
}
