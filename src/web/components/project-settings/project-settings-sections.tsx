import {
  GitBranchIcon,
  HammerIcon,
  IdCardIcon,
  PlayIcon,
  TriangleAlertIcon,
  ZapIcon,
} from "lucide-react";

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
import { RepositoryDiscovery } from "@/web/components/forms/repository/repository-discovery";
import type { ProjectAutomation } from "@/web/components/forms/repository/use-project-automation";

import { SettingsSection } from "./settings-section";

const FIELD_GRID = "grid items-start gap-x-6 gap-y-5 sm:grid-cols-2";

export function GeneralSection({
  form,
  automation,
}: {
  readonly form: ProjectFormApi;
  readonly automation: ProjectAutomation;
}) {
  return (
    <SettingsSection
      id="settings-general"
      icon={IdCardIcon}
      title="Nome e identificador do projeto"
      description="Como o projeto aparece no painel e no endereço automático."
    >
      <div className={FIELD_GRID}>
        <IdentityFields form={form} automation={automation} />
      </div>
    </SettingsSection>
  );
}

export function RepositorySection({
  form,
  savedRepositoryUrl,
  automation,
}: {
  readonly form: ProjectFormApi;
  readonly savedRepositoryUrl: string;
  readonly automation: ProjectAutomation;
}) {
  return (
    <SettingsSection
      id="settings-repository"
      icon={GitBranchIcon}
      title="Repositório do código"
      description="De onde vem o código. Precisa ter um Dockerfile."
    >
      <div className="grid items-start gap-x-6 gap-y-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)]">
        <RepositoryFields form={form} automation={automation} />
        <form.Subscribe selector={(state) => state.values.repositoryUrl !== savedRepositoryUrl}>
          {(repositoryChanged) => (repositoryChanged ? <ReapprovalWarning /> : null)}
        </form.Subscribe>
      </div>
      <RepositoryDiscovery automation={automation} />
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

export function BuildSection({
  form,
  automation,
}: {
  readonly form: ProjectFormApi;
  readonly automation: ProjectAutomation;
}) {
  return (
    <SettingsSection
      id="settings-build"
      icon={HammerIcon}
      title="Construção da imagem"
      description="Como a imagem é construída no próximo deploy."
    >
      <div className={FIELD_GRID}>
        <BuildFields form={form} automation={automation} />
      </div>
    </SettingsSection>
  );
}

export function RuntimeSection({
  form,
  automation,
}: {
  readonly form: ProjectFormApi;
  readonly automation: ProjectAutomation;
}) {
  return (
    <SettingsSection
      id="settings-runtime"
      icon={PlayIcon}
      title="Porta e verificação de saúde"
      description="Como a aplicação recebe conexões e é verificada no próximo deploy."
    >
      <div className={FIELD_GRID}>
        <PortField form={form} />
        <HealthCheckField form={form} automation={automation} />
      </div>
    </SettingsSection>
  );
}

export function AutomationSection({ form }: { readonly form: ProjectFormApi }) {
  return (
    <SettingsSection
      id="settings-automation"
      icon={ZapIcon}
      title="Automação de deploys"
      description="O que o painel faz sozinho."
    >
      <SwitchGroup>
        <AutoDeployField form={form} />
        <AutoApplyField form={form} />
        <PreviewsField form={form} />
      </SwitchGroup>
    </SettingsSection>
  );
}
