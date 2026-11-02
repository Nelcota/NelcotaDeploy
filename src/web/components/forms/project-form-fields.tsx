import { useState } from "react";

import { formatCpuCores } from "@/shared/format";
import {
  CPU_LIMIT_OPTIONS_IN_MILLICORES,
  PROJECT_BUILDERS,
  slugify,
} from "@/shared/schemas/project.schema";
import { FormField, visibleErrors } from "@/web/components/forms/form-field";
import type { ProjectFormApi } from "@/web/components/forms/project-form";
import { identityFromRepository } from "@/web/components/forms/repository-identity";
import { Input } from "@/web/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";

// Radix reserves the empty value, so "no limit" travels as this word inside the select.
const NO_CPU_LIMIT = "none";

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

/** Memory and CPU the application container may use; blank leaves it unlimited. */
export function ResourceLimitFields({ form }: { readonly form: ProjectFormApi }) {
  return (
    <>
      <form.Field name="memoryLimitInMb">
        {(field) => (
          <FormField
            id="project-memory-limit"
            label="Limite de memória (MB)"
            hint="Em branco, sem limite. Acima dele, o contêiner é reiniciado."
            errors={visibleErrors(form, field.state.meta)}
          >
            {(props) => (
              <Input
                {...props}
                inputMode="numeric"
                className="font-mono tabular-nums"
                placeholder="Sem limite"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            )}
          </FormField>
        )}
      </form.Field>
      <form.Field name="cpuLimitInMillicores">
        {(field) => (
          <FormField
            id="project-cpu-limit"
            label="Limite de CPU"
            hint="Quanto do processador do servidor a aplicação pode usar."
            errors={visibleErrors(form, field.state.meta)}
          >
            {(props) => (
              <Select
                value={field.state.value === "" ? NO_CPU_LIMIT : field.state.value}
                onValueChange={(selected) =>
                  field.handleChange(selected === NO_CPU_LIMIT ? "" : selected)
                }
              >
                <SelectTrigger {...props} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CPU_LIMIT}>Sem limite</SelectItem>
                  {CPU_LIMIT_OPTIONS_IN_MILLICORES.map((millicores) => (
                    <SelectItem key={millicores} value={String(millicores)}>
                      {formatCpuCores(millicores)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
        )}
      </form.Field>
    </>
  );
}

const BUILDER_LABELS = {
  dockerfile: "Dockerfile do repositório",
  railpack: "Detectar automaticamente (Railpack)",
} as const;

/** How the image is built: the repository's Dockerfile, or Railpack detecting the stack. */
export function BuilderField({ form }: { readonly form: ProjectFormApi }) {
  return (
    <form.Field name="builder">
      {(field) => (
        <FormField
          id="project-builder"
          label="Como construir a imagem"
          hint={
            field.state.value === "railpack"
              ? "Sem Dockerfile: o Railpack detecta Node, Bun, Python, Go e outras. A variável PORT recebe a porta interna."
              : "Usa o Dockerfile indicado abaixo."
          }
          errors={visibleErrors(form, field.state.meta)}
        >
          {(props) => (
            <Select
              value={field.state.value}
              onValueChange={(selected) => {
                const builder = PROJECT_BUILDERS.find((candidate) => candidate === selected);
                if (builder != null) {
                  field.handleChange(builder);
                }
              }}
            >
              <SelectTrigger {...props} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROJECT_BUILDERS.map((builder) => (
                  <SelectItem key={builder} value={builder}>
                    {BUILDER_LABELS[builder]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
      )}
    </form.Field>
  );
}
