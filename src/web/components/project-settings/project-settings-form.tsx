import type { ReactNode } from "react";

import { BuildSection, GeneralSection, RepositorySection } from "./project-settings-sections";
import { UnsavedChangesBar } from "./unsaved-changes-bar";
import { type SettingsProject, useProjectSettingsForm } from "./use-project-settings-form";

const SETTINGS_FORM_ID = "project-settings-form";

/**
 * The project fields split into sections, saved together from a bar that appears once
 * something changes. `children` adds more sections to the same panel, outside the form
 * element because forms cannot nest.
 */
export function ProjectSettingsForm({
  projectId,
  project,
  canEdit,
  children,
}: {
  readonly projectId: string;
  readonly project: SettingsProject;
  readonly canEdit: boolean;
  readonly children: ReactNode;
}) {
  const form = useProjectSettingsForm(projectId, project);
  return (
    <>
      <div className="divide-y divide-border/70 rounded-xl bg-card ring-1 ring-border/70">
        <form
          id={SETTINGS_FORM_ID}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <fieldset disabled={canEdit === false} className="min-w-0 divide-y divide-border/70">
            <GeneralSection form={form} />
            <RepositorySection form={form} savedRepositoryUrl={project.repositoryUrl} />
            <BuildSection form={form} />
          </fieldset>
        </form>
        {children}
      </div>
      <form.Subscribe selector={(state) => [state.isDefaultValue, state.isSubmitting] as const}>
        {([isDefaultValue, isSubmitting]) =>
          isDefaultValue ? null : (
            <UnsavedChangesBar
              formId={SETTINGS_FORM_ID}
              canEdit={canEdit}
              isSubmitting={isSubmitting}
              onDiscard={() => form.reset()}
            />
          )
        }
      </form.Subscribe>
    </>
  );
}
