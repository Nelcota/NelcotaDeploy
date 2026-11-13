import type { ProjectSettingsFormSection } from "@/shared/schemas/settings/project-settings.schema";

import type { ProjectFormValues } from "../project-form";

export const PROJECT_FORM_FIELDS = {
  repositoryUrl: { id: "project-repository", label: "Repositório GitHub", section: "repository" },
  branch: { id: "project-branch", label: "Branch", section: "repository" },
  name: { id: "project-name", label: "Nome", section: "identity" },
  builder: { id: "project-builder", label: "Como construir a imagem", section: "build" },
  composeFilePath: { id: "project-compose-file", label: "Arquivo Compose", section: "build" },
  composeService: {
    id: "project-compose-service",
    label: "Serviço que recebe os domínios",
    section: "build",
  },
  slug: { id: "project-slug", label: "Identificador", section: "identity" },
  dockerfilePath: {
    id: "project-dockerfilePath",
    label: "Caminho do Dockerfile",
    section: "build",
  },
  buildContext: { id: "project-buildContext", label: "Diretório de build", section: "build" },
  internalPort: { id: "project-port", label: "Porta interna", section: "runtime" },
  healthCheckPath: {
    id: "project-health",
    label: "Caminho do health check (opcional)",
    section: "runtime",
  },
  memoryLimitInMb: {
    id: "project-memory-limit",
    label: "Limite de memória (MB)",
    section: "runtime",
  },
  cpuLimitInMillicores: { id: "project-cpu-limit", label: "Limite de CPU", section: "runtime" },
  replicas: { id: "project-replicas", label: "Réplicas", section: "runtime" },
  autoDeploy: { id: "project-autoDeploy", label: "Deploy automático", section: "automation" },
  autoApplyChanges: {
    id: "project-autoApplyChanges",
    label: "Aplicar mudanças automaticamente",
    section: "automation",
  },
  autoRollback: { id: "project-autoRollback", label: "Rollback automático", section: "automation" },
  previewsEnabled: {
    id: "project-previewsEnabled",
    label: "Previews de pull request",
    section: "automation",
  },
} as const satisfies Record<
  keyof ProjectFormValues,
  {
    readonly id: string;
    readonly label: string;
    readonly section: ProjectSettingsFormSection;
  }
>;

export type ProjectFieldName = keyof typeof PROJECT_FORM_FIELDS;

export type ProjectFieldFailure = { readonly field: ProjectFieldName; readonly message: string };

/** Checks whether an issue belongs to a field with a summary link. */
export function isProjectField(name: string): name is ProjectFieldName {
  return Object.hasOwn(PROJECT_FORM_FIELDS, name);
}
