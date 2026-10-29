import { useForm } from "@tanstack/react-form";
import { Link } from "@tanstack/react-router";
import { LoaderCircleIcon } from "lucide-react";
import type { z } from "zod";

import { projectInputSchema } from "@/shared/schemas/project.schema";
import { ProjectFormSections } from "@/web/components/forms/project-form-sections";
import { Button } from "@/web/components/ui/button";

/** Values as typed in the form; the server parses them with `projectInputSchema`. */
export type ProjectFormValues = {
  readonly name: string;
  readonly slug: string;
  readonly repositoryUrl: string;
  readonly branch: string;
  readonly dockerfilePath: string;
  readonly buildContext: string;
  readonly internalPort: string;
  readonly healthCheckPath: string;
  readonly autoDeploy: boolean;
  readonly autoApplyChanges: boolean;
  readonly previewsEnabled: boolean;
};

/** Input accepted by the project server functions. */
export type ProjectFormInput = z.input<typeof projectInputSchema>;

/**
 * Validates the whole form and maps each issue to its field.
 *
 * @returns Field errors, or undefined when the values are valid.
 */
function validateProject(values: ProjectFormValues) {
  const result = projectInputSchema.safeParse(values);
  if (result.success) {
    return undefined;
  }
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const field = String(issue.path[0] ?? "");
    if (field !== "" && Object.hasOwn(fields, field) === false) {
      fields[field] = issue.message;
    }
  }
  return { fields };
}

export const EMPTY_PROJECT_FORM: ProjectFormValues = {
  name: "",
  slug: "",
  repositoryUrl: "",
  branch: "main",
  dockerfilePath: "Dockerfile",
  buildContext: ".",
  // Blank: each build reads the port from the Dockerfile's EXPOSE.
  internalPort: "",
  healthCheckPath: "",
  autoDeploy: true,
  autoApplyChanges: true,
  previewsEnabled: false,
};

/**
 * Converts a stored project into form values.
 *
 * @param project - Project fields as returned by the server.
 * @returns Values for {@link ProjectForm}.
 */
export function projectToFormValues(project: {
  readonly name: string;
  readonly slug: string;
  readonly repositoryUrl: string;
  readonly branch: string;
  readonly dockerfilePath: string;
  readonly buildContext: string;
  readonly internalPort: number;
  readonly internalPortAuto: boolean;
  readonly healthCheckPath: string | null;
  readonly autoDeploy: boolean;
  readonly autoApplyChanges: boolean;
  readonly previewsEnabled: boolean;
}): ProjectFormValues {
  return {
    name: project.name,
    slug: project.slug,
    repositoryUrl: project.repositoryUrl,
    branch: project.branch,
    dockerfilePath: project.dockerfilePath,
    buildContext: project.buildContext,
    internalPort: project.internalPortAuto ? "" : String(project.internalPort),
    healthCheckPath: project.healthCheckPath ?? "",
    autoDeploy: project.autoDeploy,
    autoApplyChanges: project.autoApplyChanges,
    previewsEnabled: project.previewsEnabled,
  };
}

/**
 * Creates the form state shared by the project field groups, validated with
 * `projectInputSchema` on every change.
 *
 * @param options - Starting values and the submit handler.
 * @returns The form, to pass to the field groups.
 */
export function useProjectForm({
  initialValues,
  onSubmit,
}: {
  readonly initialValues: ProjectFormValues;
  readonly onSubmit: (values: ProjectFormInput) => Promise<unknown>;
}) {
  return useForm({
    defaultValues: initialValues,
    validators: { onChange: ({ value }) => validateProject(value) },
    onSubmit: async ({ value }) => {
      await onSubmit(value);
    },
  });
}

/** Form state returned by {@link useProjectForm}. */
export type ProjectFormApi = ReturnType<typeof useProjectForm>;

function FormActions({
  form,
  submitLabel,
  disabled,
}: {
  readonly form: ProjectFormApi;
  readonly submitLabel: string;
  readonly disabled: boolean;
}) {
  return (
    <div className="flex flex-col-reverse gap-3 rounded-2xl bg-card px-5 py-4 ring-1 ring-border/70 sm:flex-row sm:items-center sm:justify-between md:px-6">
      <p className="text-xs text-muted-foreground">Dá para mudar tudo depois em Ajustes.</p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" asChild>
          <Link to="/projects">Cancelar</Link>
        </Button>
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <Button type="submit" disabled={disabled || isSubmitting}>
              {isSubmitting ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
              {submitLabel}
            </Button>
          )}
        </form.Subscribe>
      </div>
    </div>
  );
}

/**
 * Project fields in titled sections, in the order people fill them: the repository first,
 * which also suggests the name. Rarely changed build settings stay folded.
 */
export function ProjectForm({
  initialValues,
  submitLabel,
  onSubmit,
  disabled = false,
}: {
  readonly initialValues: ProjectFormValues;
  readonly submitLabel: string;
  readonly onSubmit: (values: ProjectFormInput) => Promise<unknown>;
  readonly disabled?: boolean;
}) {
  const form = useProjectForm({ initialValues, onSubmit });

  return (
    <form
      noValidate
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <fieldset disabled={disabled} className="min-w-0 space-y-6">
        <ProjectFormSections form={form} />
      </fieldset>
      <FormActions form={form} submitLabel={submitLabel} disabled={disabled} />
    </form>
  );
}
