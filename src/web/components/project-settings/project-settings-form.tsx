import { useRef } from "react";

import type { ProjectSettingsFormSection } from "@/shared/schemas/settings/project-settings.schema";
import {
  ProjectFormErrorSummary,
  useProjectFormSubmission,
  useSettingsFieldAnchor,
} from "@/web/components/forms/project-validation";

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
const SECTIONS = {
  identity: GeneralSection,
  repository: RepositorySection,
  build: BuildSection,
  runtime: RuntimeSection,
  automation: AutomationSection,
};

function SettingsFormActions({
  form,
  onDiscard,
}: {
  readonly form: ReturnType<typeof useProjectSettingsForm>["form"];
  readonly onDiscard: () => void;
}) {
  return (
    <form.Subscribe selector={(state) => [state.isDefaultValue, state.isSubmitting] as const}>
      {([isDefaultValue, isSubmitting]) => (
        <UnsavedChangesBar
          formId={SETTINGS_FORM_ID}
          changed={isDefaultValue === false}
          isSubmitting={isSubmitting}
          onDiscard={onDiscard}
        />
      )}
    </form.Subscribe>
  );
}

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
  const submission = useProjectFormSubmission(form, "Não foi possível salvar as alterações.");
  const formElement = useRef<HTMLFormElement>(null);
  useSettingsFieldAnchor(formElement);
  const Fields = SECTIONS[section];
  return (
    <>
      <form
        id={SETTINGS_FORM_ID}
        ref={formElement}
        noValidate
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();

          if (canEdit && form.state.isDefaultValue === false) {
            void submission.submit();
          }
        }}
      >
        <ProjectFormErrorSummary
          form={form}
          submission={submission}
          settings={{ projectId, section }}
          retryDisabled={canEdit === false}
        />
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <fieldset
              disabled={canEdit === false || isSubmitting}
              className="@container/fields min-w-0 space-y-4"
            >
              <Fields
                form={form}
                automation={automation}
                savedRepositoryUrl={project.repositoryUrl}
              />
            </fieldset>
          )}
        </form.Subscribe>
      </form>
      {canEdit ? (
        <SettingsFormActions
          form={form}
          onDiscard={() => {
            form.reset();
            submission.clearFailure();
          }}
        />
      ) : null}
    </>
  );
}
