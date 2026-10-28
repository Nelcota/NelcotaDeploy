import { useForm } from "@tanstack/react-form";
import { LoaderCircleIcon } from "lucide-react";
import { useState } from "react";
import type { z } from "zod";

import { projectInputSchema, slugify } from "@/shared/project.schema";

import { FormField } from "./form-field";
import { Button } from "./ui/button";
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
  // A new project derives its slug from the name until the user edits the slug directly.
  const [slugEdited, setSlugEdited] = useState(initialValues.slug !== "");
  const form = useForm({
    defaultValues: initialValues,
    validators: { onChange: ({ value }) => validateProject(value) },
    onSubmit: async ({ value }) => {
      await onSubmit(value);
    },
  });

  return (
    <form
      noValidate
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-2">
        <form.Field name="name">
          {(field) => (
            <FormField id="project-name" label="Nome" errors={field.state.meta.errors}>
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
              errors={field.state.meta.errors}
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
        <form.Field name="repositoryUrl">
          {(field) => (
            <FormField
              id="project-repository"
              label="Repositório GitHub"
              hint="URL HTTPS, por exemplo https://github.com/organizacao/api"
              errors={field.state.meta.errors}
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
            <FormField id="project-branch" label="Branch" errors={field.state.meta.errors}>
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
        <form.Field name="internalPort">
          {(field) => (
            <FormField
              id="project-port"
              label="Porta interna"
              hint="Porta em que a aplicação escuta dentro do contêiner."
              errors={field.state.meta.errors}
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
        <form.Field name="autoDeploy">
          {(field) => (
            <div className="flex items-start gap-3 rounded-md border p-3 sm:self-end">
              <Switch
                id="project-auto-deploy"
                checked={field.state.value}
                onCheckedChange={(checked) => field.handleChange(checked)}
                aria-describedby="project-auto-deploy-hint"
              />
              <div className="space-y-1">
                <label htmlFor="project-auto-deploy" className="text-[0.92rem] font-medium">
                  Deploy automático
                </label>
                <p id="project-auto-deploy-hint" className="text-[0.82rem] text-muted-foreground">
                  Faz deploy a cada push na branch, via webhook do GitHub.
                </p>
              </div>
            </div>
          )}
        </form.Field>
        <details className="group rounded-md border p-3 sm:col-span-2">
          <summary className="cursor-pointer text-[0.92rem] font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            Avançado
          </summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <form.Field name="dockerfilePath">
              {(field) => (
                <FormField
                  id="project-dockerfile"
                  label="Caminho do Dockerfile"
                  errors={field.state.meta.errors}
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
                  errors={field.state.meta.errors}
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
            <form.Field name="healthCheckPath">
              {(field) => (
                <FormField
                  id="project-health"
                  label="Caminho do health check (opcional)"
                  hint="Ex.: /health. Sem caminho, basta a porta aceitar conexões."
                  errors={field.state.meta.errors}
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
          </div>
        </details>
      </fieldset>
      <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
        {([canSubmit, isSubmitting]) => (
          <Button type="submit" disabled={disabled || canSubmit === false || isSubmitting}>
            {isSubmitting ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
            {submitLabel}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
