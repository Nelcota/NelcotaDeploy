import { useForm } from "@tanstack/react-form";
import { Link } from "@tanstack/react-router";
import { ChevronRightIcon, LoaderCircleIcon } from "lucide-react";
import type { z } from "zod";

import { projectInputSchema } from "@/shared/schemas/project.schema";
import {
  AutoDeployField,
  BuildFields,
  HealthCheckField,
  IdentityFields,
  PortField,
  RepositoryFields,
} from "@/web/components/forms/project-form-fields";
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
};

const DEFAULT_PORT = "3000";

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
  internalPort: DEFAULT_PORT,
  healthCheckPath: "",
  autoDeploy: true,
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
  readonly healthCheckPath: string | null;
  readonly autoDeploy: boolean;
}): ProjectFormValues {
  return {
    name: project.name,
    slug: project.slug,
    repositoryUrl: project.repositoryUrl,
    branch: project.branch,
    dockerfilePath: project.dockerfilePath,
    buildContext: project.buildContext,
    internalPort: String(project.internalPort),
    healthCheckPath: project.healthCheckPath ?? "",
    autoDeploy: project.autoDeploy,
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

function AdvancedSettings({ form }: { readonly form: ProjectFormApi }) {
  return (
    <details className="group border-t border-border/70 pt-5 md:col-span-2">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon
          aria-hidden
          className="size-4 transition-transform group-open:rotate-90"
        />
        Avançado
        <span className="hidden font-normal text-faint sm:inline">
          Dockerfile, diretório e health check
        </span>
      </summary>
      <div className="mt-5 grid gap-x-6 gap-y-5 md:grid-cols-2">
        <BuildFields form={form} />
        <HealthCheckField form={form} />
      </div>
    </details>
  );
}

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
    <div className="flex justify-end gap-2 border-t border-border/70 pt-5">
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
  );
}

/** Project fields with validation; less common settings live under "Avançado". */
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
      className="space-y-8"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <fieldset disabled={disabled} className="grid gap-x-6 gap-y-5 md:grid-cols-2">
        <IdentityFields form={form} />
        <RepositoryFields form={form} />
        <PortField form={form} />
        <AutoDeployField form={form} className="md:self-end" />
        <AdvancedSettings form={form} />
      </fieldset>
      <FormActions form={form} submitLabel={submitLabel} disabled={disabled} />
    </form>
  );
}
