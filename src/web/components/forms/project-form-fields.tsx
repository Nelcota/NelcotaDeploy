import { useState } from "react";

import { slugify } from "@/shared/schemas/project.schema";
import { FormField, visibleErrors } from "@/web/components/forms/form-field";
import type { ProjectFormApi } from "@/web/components/forms/project-form";
import { identityFromRepository } from "@/web/components/forms/repository-identity";
import { cn } from "@/web/components/ui/class-names";
import { Input } from "@/web/components/ui/input";
import { Switch } from "@/web/components/ui/switch";

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

/** Fills an empty name and identifier from the repository a user just pasted or picked. */
export function fillIdentityFromRepository(form: ProjectFormApi, url: string): void {
  const identity = identityFromRepository(url, {
    name: form.getFieldValue("name"),
    slug: form.getFieldValue("slug"),
  });
  if (identity.name != null) {
    form.setFieldValue("name", identity.name);
  }
  if (identity.slug != null) {
    form.setFieldValue("slug", identity.slug);
  }
}

/** GitHub repository URL and branch. */
export function RepositoryFields({ form }: { readonly form: ProjectFormApi }) {
  return (
    <>
      <form.Field
        name="repositoryUrl"
        listeners={{ onChange: ({ value }) => fillIdentityFromRepository(form, value) }}
      >
        {(field) => (
          <FormField
            id="project-repository"
            label="Repositório GitHub"
            hint="A URL HTTPS do repositório no GitHub."
            errors={visibleErrors(form, field.state.meta)}
          >
            {(props) => (
              <Input
                {...props}
                type="url"
                className="font-mono"
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

function SwitchRow({
  form,
  name,
  label,
  hint,
  className,
}: {
  readonly form: ProjectFormApi;
  readonly name: "autoDeploy" | "autoApplyChanges";
  readonly label: string;
  readonly hint: string;
  readonly className?: string | undefined;
}) {
  const id = `project-${name}`;
  return (
    <form.Field name={name}>
      {(field) => (
        <div
          className={cn(
            "flex items-center justify-between gap-6 rounded-xl px-4 py-3.5 ring-1 ring-border/70 ring-inset",
            className,
          )}
        >
          <div className="min-w-0 space-y-0.5">
            <label htmlFor={id} className="text-sm font-medium">
              {label}
            </label>
            <p id={`${id}-hint`} className="text-xs text-muted-foreground">
              {hint}
            </p>
          </div>
          <Switch
            id={id}
            checked={field.state.value}
            onCheckedChange={(checked) => field.handleChange(checked)}
            aria-describedby={`${id}-hint`}
          />
        </div>
      )}
    </form.Field>
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
    <SwitchRow
      form={form}
      name="autoDeploy"
      label="Deploy automático"
      hint="Faz deploy a cada push na branch, via webhook do GitHub."
      className={className}
    />
  );
}

/** Switch that recreates the live container whenever variables or domains change. */
export function AutoApplyField({
  form,
  className,
}: {
  readonly form: ProjectFormApi;
  readonly className?: string;
}) {
  return (
    <SwitchRow
      form={form}
      name="autoApplyChanges"
      label="Aplicar mudanças automaticamente"
      hint="Recria o contêiner ao salvar variáveis ou domínios."
      className={className}
    />
  );
}

/** Port the application listens on inside the container; blank reads it from the Dockerfile. */
export function PortField({ form }: { readonly form: ProjectFormApi }) {
  return (
    <form.Field name="internalPort">
      {(field) => (
        <FormField
          id="project-port"
          label="Porta interna"
          hint="Em branco, cada deploy usa a porta do EXPOSE do Dockerfile."
          errors={visibleErrors(form, field.state.meta)}
        >
          {(props) => (
            <Input
              {...props}
              inputMode="numeric"
              className="font-mono tabular-nums"
              placeholder="Automática"
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
