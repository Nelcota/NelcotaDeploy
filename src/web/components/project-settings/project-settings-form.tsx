import type { ProjectSettingsFormSection } from "@/shared/schemas/settings/project-settings.schema";

import {
  AutomationSection,
  BuildSection,
  GeneralSection,
  RepositorySection,
  RuntimeSection,
} from "./project-settings-sections";
import { UnsavedChangesBar } from "./unsaved-changes-bar";
import { type SettingsProject, useProjectSettingsForm } from "./use-project-settings-form";

const SETTINGS_FORM_ID = "project-settings-form";
const SAVE_LABELS: Readonly<Record<ProjectSettingsFormSection, string>> = {
  identity: "Salvar nome e identificador",
  repository: "Salvar repositório do código",
  build: "Salvar configuração da imagem",
  runtime: "Salvar porta e verificação de saúde",
  automation: "Salvar automação de deploys",
};
const SECTIONS = {
  identity: GeneralSection,
  repository: RepositorySection,
  build: BuildSection,
  runtime: RuntimeSection,
  automation: AutomationSection,
};

/** Saves the fields of one settings page. Other pages keep their current saved values. */
export function ProjectSettingsForm({
  projectId,
  project,
  canEdit,
  section,
}: {
  readonly projectId: string;
  readonly project: SettingsProject;
  readonly canEdit: boolean;
  readonly section: ProjectSettingsFormSection;
}) {
  const { form, automation } = useProjectSettingsForm({ projectId, project, canEdit, section });
  const Fields = SECTIONS[section];
  return (
    <>
      <form
        id={SETTINGS_FORM_ID}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <fieldset disabled={canEdit === false || isSubmitting} className="min-w-0 space-y-6">
              <Fields
                form={form}
                automation={automation}
                savedRepositoryUrl={project.repositoryUrl}
              />
            </fieldset>
          )}
        </form.Subscribe>
      </form>
      <form.Subscribe selector={(state) => [state.isDefaultValue, state.isSubmitting] as const}>
        {([isDefaultValue, isSubmitting]) =>
          isDefaultValue ? null : (
            <UnsavedChangesBar
              formId={SETTINGS_FORM_ID}
              canEdit={canEdit}
              isSubmitting={isSubmitting}
              saveLabel={SAVE_LABELS[section]}
              onDiscard={() => form.reset()}
            />
          )
        }
      </form.Subscribe>
    </>
  );
}
