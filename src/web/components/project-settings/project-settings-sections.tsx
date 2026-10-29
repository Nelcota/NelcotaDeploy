import { GitBranchIcon, HammerIcon, IdCardIcon, TriangleAlertIcon } from "lucide-react";

import type { ProjectFormApi } from "@/web/components/forms/project-form";
import {
  AutoDeployField,
  BuildFields,
  HealthCheckField,
  IdentityFields,
  PortField,
  RepositoryFields,
} from "@/web/components/forms/project-form-fields";

import { SettingsSection } from "./settings-section";

const FIELD_GRID = "grid gap-x-6 gap-y-5 sm:grid-cols-2";

export function GeneralSection({ form }: { readonly form: ProjectFormApi }) {
  return (
    <SettingsSection icon={IdCardIcon} title="Geral">
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
    <SettingsSection icon={GitBranchIcon} title="Repositório">
      <div className={FIELD_GRID}>
        <RepositoryFields form={form} />
        <AutoDeployField form={form} className="sm:col-span-2" />
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
    <SettingsSection icon={HammerIcon} title="Build e execução">
      <div className={FIELD_GRID}>
        <PortField form={form} />
        <HealthCheckField form={form} />
        <BuildFields form={form} />
      </div>
    </SettingsSection>
  );
}
