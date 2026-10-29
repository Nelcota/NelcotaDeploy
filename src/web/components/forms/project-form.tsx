import { useForm } from "@tanstack/react-form";
import { Link } from "@tanstack/react-router";
import {
  ChevronRightIcon,
  GitBranchIcon,
  HammerIcon,
  IdCardIcon,
  LoaderCircleIcon,
  RocketIcon,
} from "lucide-react";
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
import { SettingsSection } from "@/web/components/project-settings/settings-section";
import { Button } from "@/web/components/ui/button";
import { cn } from "@/web/components/ui/class-names";

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
    <div className="flex flex-col-reverse gap-3 border-t border-border/70 bg-muted/30 px-5 py-4 sm:flex-row sm:items-center sm:justify-between md:px-6">
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

/** The sections of the form: repository, identity, runtime and build. */
function ProjectFormSections({ form }: { readonly form: ProjectFormApi }) {
  return (
    <>
      <SettingsSection
        icon={GitBranchIcon}
        title="Repositório"
        description="Precisa ter um Dockerfile."
      >
        <div className="grid gap-x-5 gap-y-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,11rem)]">
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
      className="overflow-hidden rounded-2xl bg-card ring-1 ring-border/70"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <fieldset disabled={disabled} className="divide-y divide-border/70">
        <ProjectFormSections form={form} />
      </fieldset>
      <FormActions form={form} submitLabel={submitLabel} disabled={disabled} />
    </form>
  );
}
