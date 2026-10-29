import { ChevronRightIcon, GitBranchIcon, HammerIcon, IdCardIcon, RocketIcon } from "lucide-react";

import type { ProjectFormApi } from "@/web/components/forms/project-form";
import {
  BuildFields,
  HealthCheckField,
  IdentityFields,
  PortField,
  RepositoryFields,
} from "@/web/components/forms/project-form-fields";
import { AutoDeployField } from "@/web/components/forms/project-switch-fields";
import { GitHubRepositoryPicker } from "@/web/components/github/github-repository-picker";
import { SettingsSection } from "@/web/components/project-settings/settings-section";
import { cn } from "@/web/components/ui/class-names";

const PAIR_GRID = "grid gap-x-5 gap-y-5 sm:grid-cols-2";

function AdvancedSettings({ form }: { readonly form: ProjectFormApi }) {
  return (
    <details className="group">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon
          aria-hidden
          className="size-4 transition-transform group-open:rotate-90 motion-reduce:transition-none"
        />
        Mostrar Dockerfile, diretório e health check
      </summary>
      <div className={cn(PAIR_GRID, "mt-5")}>
        <BuildFields form={form} />
        <HealthCheckField form={form} />
      </div>
    </details>
  );
}

/** The sections of the form: repository, identity, runtime and build. */
export function ProjectFormSections({ form }: { readonly form: ProjectFormApi }) {
  return (
    <>
      <SettingsSection
        icon={GitBranchIcon}
        title="Repositório"
        description="Precisa ter um Dockerfile."
      >
        <div className="grid gap-x-5 gap-y-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,11rem)]">
          <GitHubRepositoryPicker form={form} />
          <RepositoryFields form={form} />
        </div>
      </SettingsSection>
      <SettingsSection icon={IdCardIcon} title="Identificação">
        <div className={PAIR_GRID}>
          <IdentityFields form={form} />
        </div>
      </SettingsSection>
      <SettingsSection icon={RocketIcon} title="Execução">
        <div className="space-y-5">
          <div className="sm:max-w-56">
            <PortField form={form} />
          </div>
          <AutoDeployField form={form} />
        </div>
      </SettingsSection>
      <SettingsSection
        icon={HammerIcon}
        title="Build"
        description="Opcional. Os padrões servem para a maioria."
      >
        <AdvancedSettings form={form} />
      </SettingsSection>
    </>
  );
}
