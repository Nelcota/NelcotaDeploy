import { ChevronRightIcon, GitBranchIcon, HammerIcon, IdCardIcon, RocketIcon } from "lucide-react";

import type { ProjectFormApi } from "@/web/components/forms/project-form";
import {
  BuilderField,
  BuildFields,
  HealthCheckField,
  IdentityFields,
  PortField,
  RepositoryFields,
  ResourceLimitFields,
} from "@/web/components/forms/project-form-fields";
import { AutoDeployField, SwitchGroup } from "@/web/components/forms/project-switch-fields";
import { GitHubRepositoryPicker } from "@/web/components/github/github-repository-picker";
import { SettingsSection } from "@/web/components/project-settings/settings-section";
import { cn } from "@/web/components/ui/class-names";

import { RepositoryDiscovery } from "./repository/repository-discovery";
import type { ProjectAutomation } from "./repository/use-project-automation";

const PAIR_GRID = "grid gap-x-5 gap-y-5 sm:grid-cols-2";

function AdvancedSettings({
  form,
  automation,
}: {
  readonly form: ProjectFormApi;
  readonly automation: ProjectAutomation;
}) {
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
        <BuildFields form={form} automation={automation} />
        <HealthCheckField form={form} automation={automation} />
      </div>
    </details>
  );
}

/** The sections of the form: repository, identity, runtime and build. */
export function ProjectFormSections({
  form,
  automation,
}: {
  readonly form: ProjectFormApi;
  readonly automation: ProjectAutomation;
}) {
  return (
    <>
      <SettingsSection
        icon={GitBranchIcon}
        title="Repositório"
        description="Com um Dockerfile, ou sem ele: o Railpack detecta a linguagem e monta a imagem."
      >
        <div className="grid gap-x-5 gap-y-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,11rem)]">
          <GitHubRepositoryPicker form={form} />
          <RepositoryFields form={form} automation={automation} />
        </div>
        <RepositoryDiscovery automation={automation} />
      </SettingsSection>
      <SettingsSection icon={IdCardIcon} title="Identificação">
        <div className={PAIR_GRID}>
          <IdentityFields form={form} automation={automation} />
        </div>
      </SettingsSection>
      <SettingsSection icon={RocketIcon} title="Execução">
        <div className="space-y-5">
          <div className={PAIR_GRID}>
            <PortField form={form} />
            <ResourceLimitFields form={form} />
          </div>
          <SwitchGroup>
            <AutoDeployField form={form} />
          </SwitchGroup>
        </div>
      </SettingsSection>
      <SettingsSection
        icon={HammerIcon}
        title="Build"
        description="Opcional. Os padrões servem para a maioria."
      >
        <div className="space-y-5">
          <div className="sm:max-w-sm">
            <BuilderField form={form} />
          </div>
          <AdvancedSettings form={form} automation={automation} />
        </div>
      </SettingsSection>
    </>
  );
}
