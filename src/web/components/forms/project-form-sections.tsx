import { ChevronDownIcon, GitBranchIcon, RocketIcon, SlidersHorizontalIcon } from "lucide-react";

import { GitHubRepositoryPicker } from "@/web/components/github/github-repository-picker";
import { SettingsSection } from "@/web/components/project-settings/settings-section";

import { ComposeFields } from "./compose-fields";
import type { ProjectFormApi } from "./project-form";
import {
  BuilderField,
  BuildFields,
  HealthCheckField,
  PortField,
  ProjectNameField,
  ProjectSlugField,
  RepositoryFields,
  ResourceLimitFields,
} from "./project-form-fields";
import { AutoDeployField, SwitchGroup } from "./project-switch-fields";
import { RepositoryDiscovery } from "./repository/repository-discovery";
import type { ProjectAutomation } from "./repository/use-project-automation";

const FIELD_GRID = "grid items-start gap-4 sm:grid-cols-2";
type SectionProps = {
  readonly form: ProjectFormApi;
  readonly automation: ProjectAutomation;
};

function AdvancedSettings({ form, automation }: SectionProps) {
  return (
    <details data-project-advanced className="group rounded-xl border border-border bg-card">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <SlidersHorizontalIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex-1">Ajustes avançados</span>
        <ChevronDownIcon aria-hidden className="size-4 shrink-0 group-open:rotate-180" />
      </summary>
      <div className="space-y-5 border-t border-border p-4 md:p-5">
        <div className={FIELD_GRID}>
          <ProjectSlugField form={form} automation={automation} />
          <form.Subscribe selector={(state) => state.values.builder}>
            {(builder) =>
              builder === "compose" ? null : (
                <>
                  <BuildFields form={form} automation={automation} hideUnusedDockerfile />
                  <PortField form={form} />
                </>
              )
            }
          </form.Subscribe>
          <HealthCheckField form={form} automation={automation} />
          <ResourceLimitFields form={form} />
        </div>
        <SwitchGroup>
          <AutoDeployField form={form} />
        </SwitchGroup>
      </div>
    </details>
  );
}

/** Shows the fields needed to create the project, with optional settings grouped below. */
export function ProjectFormSections({ form, automation }: SectionProps) {
  return (
    <>
      <SettingsSection icon={GitBranchIcon} title="Código-fonte">
        <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,11rem)]">
          <GitHubRepositoryPicker form={form} />
          <RepositoryFields form={form} automation={automation} />
        </div>
        <RepositoryDiscovery automation={automation} creating />
      </SettingsSection>
      <SettingsSection icon={RocketIcon} title="Projeto e build">
        <div className={FIELD_GRID}>
          <ProjectNameField form={form} automation={automation} />
          <BuilderField form={form} />
          <form.Subscribe selector={(state) => state.values.builder === "compose"}>
            {(usesCompose) =>
              usesCompose ? (
                <>
                  <ComposeFields form={form} />
                  <PortField form={form} />
                </>
              ) : null
            }
          </form.Subscribe>
        </div>
      </SettingsSection>
      <AdvancedSettings form={form} automation={automation} />
    </>
  );
}
