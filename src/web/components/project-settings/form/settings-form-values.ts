import type { ProjectSettingsFormSection } from "@/shared/schemas/settings/project-settings.schema";
import { projectValuesForBuilder } from "@/web/components/forms/new-project-values";
import type { ProjectFormValues } from "@/web/components/forms/project-form";
import { isProjectField, PROJECT_FORM_FIELDS } from "@/web/components/forms/project-validation";

const FIELDS = Object.keys(PROJECT_FORM_FIELDS).filter(isProjectField);

/** Validates a section's draft against the latest saved values of the other sections. */
export function settingsFormValues(
  draft: ProjectFormValues,
  saved: ProjectFormValues,
  section: ProjectSettingsFormSection,
): ProjectFormValues {
  const changes = Object.fromEntries(
    FIELDS.filter((field) => PROJECT_FORM_FIELDS[field].section === section).map((field) => [
      field,
      draft[field],
    ]),
  );
  return projectValuesForBuilder({ ...saved, ...changes }, saved);
}
