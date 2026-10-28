import { useForm } from "@tanstack/react-form";
import { Link } from "@tanstack/react-router";
import { ChevronRightIcon, LoaderCircleIcon } from "lucide-react";
import { useState } from "react";
import type { z } from "zod";

import { projectInputSchema, slugify } from "@/shared/project.schema";

import { FormField } from "./form-field";
import { Button } from "./ui/button";
import { cn } from "./ui/class-names";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";

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

type ProjectFormApi = ReturnType<typeof useProjectForm>;

/**
 * Errors worth showing for a field: only once the user left it or tried to submit, so a
 * half-typed form is not covered in red.
 */
function visibleErrors(
  form: ProjectFormApi,
  meta: { readonly isBlurred: boolean; readonly errors: readonly unknown[] },
): readonly unknown[] {
  return meta.isBlurred || form.state.submissionAttempts > 0 ? meta.errors : [];
}

/** Name and slug; a new project derives its slug from the name until the slug is edited. */
export function IdentityFields({ form }: { readonly form: ProjectFormApi }) {
  const [slugEdited, setSlugEdited] = useState(() => form.getFieldValue("slug") !== "");
  return (
    <>
      <form.Field name="name">
        {(field) => (
          <FormField id="project-name" label="Nome" errors={visibleErrors(form, field.state.meta)}>
            {(props) => (
              <Input
                {...props}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  field.handleChange(event.target.value);
                  if (slugEdited === false) {
                    form.setFieldValue("slug", slugify(event.target.value));
                  }
                }}
              />
            )}
          </FormField>
        )}
      </form.Field>
      <form.Field name="slug">
        {(field) => (
          <FormField
            id="project-slug"
            label="Identificador"
            hint="Usado no nome do contêiner e no domínio automático."
            errors={visibleErrors(form, field.state.meta)}
          >
            {(props) => (
              <Input
                {...props}
                className="font-mono"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  setSlugEdited(true);
                  field.handleChange(event.target.value);
                }}
              />
            )}
          </FormField>
        )}
      </form.Field>
    </>
  );
}

/** GitHub repository URL and branch. */
export function RepositoryFields({ form }: { readonly form: ProjectFormApi }) {
  return (
    <>
      <form.Field name="repositoryUrl">
        {(field) => (
          <FormField
            id="project-repository"
            label="Repositório GitHub"
            hint="URL HTTPS, por exemplo https://github.com/organizacao/api"
            errors={visibleErrors(form, field.state.meta)}
          >
            {(props) => (
              <Input
                {...props}
                type="url"
                placeholder="https://github.com/organizacao/repositorio"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            )}
          </FormField>
        )}
      </form.Field>
      <form.Field name="branch">
        {(field) => (
          <FormField
            id="project-branch"
            label="Branch"
            errors={visibleErrors(form, field.state.meta)}
          >
            {(props) => (
              <Input
                {...props}
                className="font-mono"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            )}
          </FormField>
        )}
      </form.Field>
    </>
  );
}

/** Switch that turns deploys on push on or off. */
export function AutoDeployField({
  form,
  className,
}: {
  readonly form: ProjectFormApi;
  readonly className?: string;
}) {
  return (
    <form.Field name="autoDeploy">
      {(field) => (
        <div
          className={cn(
            "flex items-start gap-3 rounded-lg bg-secondary/60 p-3.5 ring-1 ring-border/70 ring-inset",
            className,
          )}
        >
          <Switch
            id="project-auto-deploy"
            checked={field.state.value}
            onCheckedChange={(checked) => field.handleChange(checked)}
            aria-describedby="project-auto-deploy-hint"
          />
          <div className="space-y-1">
            <label htmlFor="project-auto-deploy" className="text-sm font-medium">
              Deploy automático
            </label>
            <p id="project-auto-deploy-hint" className="text-xs text-muted-foreground">
              Faz deploy a cada push na branch, via webhook do GitHub.
            </p>
          </div>
        </div>
      )}
    </form.Field>
  );
}

/** Port the application listens on inside the container. */
export function PortField({ form }: { readonly form: ProjectFormApi }) {
  return (
    <form.Field name="internalPort">
      {(field) => (
        <FormField
          id="project-port"
          label="Porta interna"
          hint="Porta em que a aplicação escuta dentro do contêiner."
          errors={visibleErrors(form, field.state.meta)}
        >
          {(props) => (
            <Input
              {...props}
              inputMode="numeric"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          )}
        </FormField>
      )}
    </form.Field>
  );
}

/** Optional HTTP path checked before a new container takes traffic. */
export function HealthCheckField({ form }: { readonly form: ProjectFormApi }) {
  return (
    <form.Field name="healthCheckPath">
      {(field) => (
        <FormField
          id="project-health"
          label="Caminho do health check (opcional)"
          hint="Ex.: /health. Sem caminho, basta a porta aceitar conexões."
          errors={visibleErrors(form, field.state.meta)}
        >
          {(props) => (
            <Input
              {...props}
              className="font-mono"
              placeholder="/health"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          )}
        </FormField>
      )}
    </form.Field>
  );
}

/** Dockerfile path and build context inside the repository. */
export function BuildFields({ form }: { readonly form: ProjectFormApi }) {
  return (
    <>
      <form.Field name="dockerfilePath">
        {(field) => (
          <FormField
            id="project-dockerfile"
            label="Caminho do Dockerfile"
            errors={visibleErrors(form, field.state.meta)}
          >
            {(props) => (
              <Input
                {...props}
                className="font-mono"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            )}
          </FormField>
        )}
      </form.Field>
      <form.Field name="buildContext">
        {(field) => (
          <FormField
            id="project-context"
            label="Diretório de build"
            hint="Relativo à raiz do repositório."
            errors={visibleErrors(form, field.state.meta)}
          >
            {(props) => (
              <Input
                {...props}
                className="font-mono"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            )}
          </FormField>
        )}
      </form.Field>
    </>
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
        <details className="group border-t border-border/70 pt-5 md:col-span-2">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden">
            <ChevronRightIcon
              aria-hidden
              className="size-4 transition-transform group-open:rotate-90"
            />
            Avançado
            <span className="font-normal text-faint">Dockerfile, diretório e health check</span>
          </summary>
          <div className="mt-5 grid gap-x-6 gap-y-5 md:grid-cols-2">
            <BuildFields form={form} />
            <HealthCheckField form={form} />
          </div>
        </details>
      </fieldset>
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
    </form>
  );
}
