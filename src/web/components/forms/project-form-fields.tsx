import { slugify } from "@/shared/schemas/project.schema";
import { FormField, visibleErrors } from "@/web/components/forms/form-field";
import type { ProjectFormApi } from "@/web/components/forms/project-form";
import { Input } from "@/web/components/ui/input";

import { DetectedProjectField } from "./repository/detected-project-field";
import { HealthCheckDiscovery } from "./repository/health-check-discovery";
import type { ProjectAutomation } from "./repository/use-project-automation";

/** Name and slug; a new project derives its slug from the name until the slug is edited. */
export function IdentityFields({
  form,
  automation,
}: {
  readonly form: ProjectFormApi;
  readonly automation: ProjectAutomation;
}) {
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
                  automation.markEdited("name");
                  if (automation.manualFields.has("slug") === false) {
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
                  automation.markEdited("slug");
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
export function RepositoryFields({
  form,
  automation,
}: {
  readonly form: ProjectFormApi;
  readonly automation: ProjectAutomation;
}) {
  return (
    <>
      <form.Field name="repositoryUrl">
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
      <DetectedProjectField
        form={form}
        automation={automation}
        name="branch"
        label="Branch"
        hint="Detectada pelo GitHub. Escolha uma sugestão ou personalize."
        suggestions={automation.inspection.data?.branches ?? []}
      />
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
export function HealthCheckField({
  form,
  automation,
}: {
  readonly form: ProjectFormApi;
  readonly automation: ProjectAutomation;
}) {
  return (
    <form.Field name="healthCheckPath">
      {(field) => (
        <FormField
          id="project-health"
          label="Caminho do health check (opcional)"
          hint="Detectado a partir de um HEALTHCHECK HTTP local no Dockerfile. Sem caminho, basta a porta aceitar conexões."
          errors={visibleErrors(form, field.state.meta)}
        >
          {(props) => (
            <div className="space-y-2">
              <Input
                {...props}
                className="font-mono"
                placeholder="/health"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  automation.markEdited("healthCheckPath");
                  field.handleChange(event.target.value);
                }}
              />
              <HealthCheckDiscovery automation={automation} />
            </div>
          )}
        </FormField>
      )}
    </form.Field>
  );
}

/** Dockerfile path and build context inside the repository. */
export function BuildFields({
  form,
  automation,
}: {
  readonly form: ProjectFormApi;
  readonly automation: ProjectAutomation;
}) {
  return (
    <>
      <DetectedProjectField
        form={form}
        automation={automation}
        name="dockerfilePath"
        label="Caminho do Dockerfile"
        hint="Escolha um arquivo encontrado ou personalize o caminho."
        suggestions={automation.inspection.data?.dockerfiles ?? []}
      />
      <DetectedProjectField
        form={form}
        automation={automation}
        name="buildContext"
        label="Diretório de build"
        hint="Relativo à raiz. A raiz é mantida até você escolher outro diretório."
        suggestions={automation.inspection.data?.directories ?? []}
      />
    </>
  );
}
