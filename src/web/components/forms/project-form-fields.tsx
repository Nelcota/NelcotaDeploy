import { formatCpuCores } from "@/shared/format";
import {
  CPU_LIMIT_OPTIONS_IN_MILLICORES,
  MAX_REPLICAS,
  PROJECT_BUILDERS,
  type ProjectBuilder,
  slugify,
} from "@/shared/schemas/project.schema";
import { ComposeFields } from "@/web/components/forms/compose-fields";
import { FormField, visibleErrors } from "@/web/components/forms/form-field";
import type { ProjectFormApi } from "@/web/components/forms/project-form";
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
    <form.Subscribe selector={(state) => state.values.builder}>
      {(builder) =>
        builder === "compose" ? (
          <ComposeFields form={form} />
        ) : (
          <DockerfileFields form={form} automation={automation} />
        )
      }
    </form.Subscribe>
  );
}

function DockerfileFields({
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

/**
 * Memory and CPU each application container may use, blank leaving it unlimited, and how many
 * replicas share the requests.
 */
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
      <form.Field name="replicas">
        {(field) => (
          <FormField
            id="project-replicas"
            label="Réplicas"
            hint={`De 1 a ${MAX_REPLICAS}. As requisições são divididas entre elas; os limites valem para cada uma. Projetos com volumes usam só 1.`}
            errors={visibleErrors(form, field.state.meta)}
          >
            {(props) => (
              <Input
                {...props}
                inputMode="numeric"
                className="font-mono tabular-nums"
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

const BUILDER_LABELS = {
  dockerfile: "Dockerfile do repositório",
  railpack: "Detectar automaticamente (Railpack)",
  compose: "Docker Compose do repositório",
} as const satisfies Record<ProjectBuilder, string>;

const BUILDER_HINTS = {
  dockerfile: "Usa o Dockerfile indicado abaixo.",
  railpack:
    "Sem Dockerfile: o Railpack detecta Node, Bun, Python, Go e outras. A variável PORT recebe a porta interna.",
  compose:
    "Sobe todos os serviços do arquivo, com 1 réplica e sem previews. Os serviços mudados são recriados no lugar, com alguns segundos fora do ar.",
} as const satisfies Record<ProjectBuilder, string>;

/** How the project is built: its Dockerfile, Railpack detecting the stack, or its Compose file. */
export function BuilderField({ form }: { readonly form: ProjectFormApi }) {
  return (
    <form.Field name="builder">
      {(field) => (
        <FormField
          id="project-builder"
          label="Como construir a imagem"
          hint={BUILDER_HINTS[field.state.value]}
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
