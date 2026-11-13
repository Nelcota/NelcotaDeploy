import { useForm } from "@tanstack/react-form";
import { Link } from "@tanstack/react-router";
import { LoaderCircleIcon } from "lucide-react";
import type { z } from "zod";

import { type ProjectBuilder, projectInputSchema } from "@/shared/schemas/project.schema";
import { ProjectFormSections } from "@/web/components/forms/project-form-sections";
import { Button } from "@/web/components/ui/button";

import { newProjectValues } from "./new-project-values";
import {
  isProjectField,
  type ProjectFieldFailure,
  type ProjectFieldName,
  ProjectFormErrorSummary,
  useProjectFormSubmission,
} from "./project-validation";
import { useProjectAutomation } from "./repository/use-project-automation";

/** Values as typed in the form; the server parses them with `projectInputSchema`. */
export type ProjectFormValues = {
  readonly name: string;
  readonly slug: string;
  readonly repositoryUrl: string;
  readonly branch: string;
  readonly builder: ProjectBuilder;
  readonly dockerfilePath: string;
  readonly buildContext: string;
  readonly internalPort: string;
  readonly healthCheckPath: string;
  readonly autoDeploy: boolean;
  readonly autoApplyChanges: boolean;
  readonly autoRollback: boolean;
  readonly previewsEnabled: boolean;
  /** Blank for no limit. */
  readonly memoryLimitInMb: string;
  /** Thousandths of a core as text; blank for no limit. */
  readonly cpuLimitInMillicores: string;
  /** Containers each deployment runs, as text. */
  readonly replicas: string;
  readonly composeFilePath: string;
  /** Blank unless built with Docker Compose. */
  readonly composeService: string;
};

/** Input accepted by the project server functions. */
export type ProjectFormInput = z.input<typeof projectInputSchema>;

/**
 * Validates the whole form and maps each issue to its field.
 *
 * @returns Field errors, or undefined when the values are valid.
 */
export function validateProject(values: ProjectFormValues) {
  const result = projectInputSchema.safeParse(values);
  if (result.success) {
    return undefined;
  }
  const fields: Partial<Record<ProjectFieldName, string>> = {};
  for (const issue of result.error.issues) {
    const field = String(issue.path[0] ?? "");
    if (isProjectField(field) && fields[field] == null) {
      fields[field] =
        issue.code === "invalid_union" ? invalidNumberMessage(field, issue.errors) : issue.message;
    }
  }
  return { fields };
}

function invalidNumberMessage(
  field: ProjectFieldName,
  errors: readonly z.core.$ZodIssue[][],
): string {
  const issue = errors
    .flat()
    .find(
      (candidate) =>
        candidate.code === "too_big" ||
        candidate.code === "too_small" ||
        (candidate.code === "invalid_type" && candidate.expected === "int"),
    );
  if (issue != null) {
    return issue.message;
  }

  if (field === "internalPort") {
    return "Informe uma porta com números ou deixe em branco para detectar automaticamente";
  }

  if (field === "memoryLimitInMb") {
    return "Informe o limite de memória com números ou deixe em branco para remover o limite";
  }

  return "Informe um número válido";
}

export const EMPTY_PROJECT_FORM: ProjectFormValues = {
  name: "",
  slug: "",
  repositoryUrl: "",
  branch: "main",
  builder: "dockerfile",
  dockerfilePath: "Dockerfile",
  buildContext: ".",
  // Blank: each build reads the port from the Dockerfile's EXPOSE.
  internalPort: "",
  healthCheckPath: "",
  autoDeploy: true,
  autoApplyChanges: true,
  autoRollback: true,
  previewsEnabled: false,
  memoryLimitInMb: "",
  cpuLimitInMillicores: "",
  replicas: "1",
  composeFilePath: "compose.yaml",
  composeService: "",
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
  readonly builder: ProjectBuilder;
  readonly dockerfilePath: string;
  readonly buildContext: string;
  readonly internalPort: number;
  readonly internalPortAuto: boolean;
  readonly healthCheckPath: string | null;
  readonly autoDeploy: boolean;
  readonly autoApplyChanges: boolean;
  readonly autoRollback: boolean;
  readonly previewsEnabled: boolean;
  readonly memoryLimitInMb: number | null;
  readonly cpuLimitInMillicores: number | null;
  readonly replicas: number;
  readonly composeFilePath: string;
  readonly composeService: string | null;
}): ProjectFormValues {
  return {
    name: project.name,
    slug: project.slug,
    repositoryUrl: project.repositoryUrl,
    branch: project.branch,
    builder: project.builder,
    dockerfilePath: project.dockerfilePath,
    buildContext: project.buildContext,
    internalPort: project.internalPortAuto ? "" : String(project.internalPort),
    healthCheckPath: project.healthCheckPath ?? "",
    autoDeploy: project.autoDeploy,
    autoApplyChanges: project.autoApplyChanges,
    autoRollback: project.autoRollback,
    previewsEnabled: project.previewsEnabled,
    memoryLimitInMb: project.memoryLimitInMb == null ? "" : String(project.memoryLimitInMb),
    cpuLimitInMillicores:
      project.cpuLimitInMillicores == null ? "" : String(project.cpuLimitInMillicores),
    replicas: String(project.replicas),
    composeFilePath: project.composeFilePath,
    composeService: project.composeService ?? "",
  };
}

/**
 * Creates the form state shared by the project field groups, validated with
 * `projectInputSchema` on every change.
 *
 * @param options - Starting values and the submit handler.
 * @returns The form, to pass to the field groups.
 */
function useBaseProjectForm({
  initialValues,
  onSubmit,
  prepareValues,
}: {
  readonly initialValues: ProjectFormValues;
  readonly onSubmit: (values: ProjectFormInput) => Promise<ProjectFieldFailure | undefined>;
  readonly prepareValues?: (values: ProjectFormValues) => ProjectFormValues;
}) {
  const validate = ({ value }: { readonly value: ProjectFormValues }) =>
    validateProject(prepareValues?.(value) ?? value);
  return useForm({
    defaultValues: initialValues,
    validators: { onChange: validate, onSubmit: validate },
    onSubmit: async ({ value, formApi }) => {
      const failure = await onSubmit(prepareValues?.(value) ?? value);
      if (failure != null) {
        formApi.setErrorMap({ onSubmit: { fields: { [failure.field]: failure.message } } });
      }
    },
  });
}

/** Form state returned by {@link useProjectForm}. */
export type ProjectFormApi = ReturnType<typeof useBaseProjectForm>;

/** Creates a project form with automatic repository discovery and editable suggestions. */
export function useProjectForm(
  options: Parameters<typeof useBaseProjectForm>[0] & {
    readonly projectId?: string;
    readonly canDetect?: boolean;
  },
) {
  const form = useBaseProjectForm(options);
  const automation = useProjectAutomation(form, options.initialValues, {
    projectId: options.projectId,
    enabled: options.canDetect,
  });
  return { form, automation };
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
    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground">Criar o projeto não inicia um deploy.</p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" asChild>
          <Link to="/projects">Cancelar</Link>
        </Button>
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <Button
              type="submit"
              className="min-h-11 flex-1 sm:flex-none"
              disabled={disabled || isSubmitting}
            >
              {isSubmitting ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
              {isSubmitting ? "Criando projeto…" : submitLabel}
            </Button>
          )}
        </form.Subscribe>
      </div>
    </div>
  );
}

/**
 * Creates a project from the repository and build choice, with optional settings folded.
 */
export function ProjectForm({
  initialValues,
  submitLabel,
  onSubmit,
  disabled = false,
}: {
  readonly initialValues: ProjectFormValues;
  readonly submitLabel: string;
  readonly onSubmit: (values: ProjectFormInput) => Promise<ProjectFieldFailure | undefined>;
  readonly disabled?: boolean;
}) {
  const { form, automation } = useProjectForm({
    initialValues,
    onSubmit,
    prepareValues: (values) => newProjectValues(values, initialValues),
    canDetect: disabled === false,
  });
  const submission = useProjectFormSubmission(form, "Não foi possível criar o projeto.");
  const submitDisabled = disabled || automation.isDetecting;

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (submitDisabled === false) {
          void submission.submit();
        }
      }}
    >
      <ProjectFormErrorSummary form={form} submission={submission} retryDisabled={submitDisabled} />
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(isSubmitting) => (
          <fieldset disabled={disabled || isSubmitting} className="min-w-0 space-y-4">
            <ProjectFormSections form={form} automation={automation} />
          </fieldset>
        )}
      </form.Subscribe>
      <FormActions form={form} submitLabel={submitLabel} disabled={submitDisabled} />
    </form>
  );
}
