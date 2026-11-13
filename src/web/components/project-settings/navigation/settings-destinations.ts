import type { Permission } from "@/shared/roles";

const PROJECT_SETTINGS_SECTIONS = [
  {
    id: "identity",
    group: "Projeto",
    icon: "solar-[folder-2-bold-duotone]",
    label: "Nome e identificador",
    description: "Mude o nome no painel e o identificador usado no endereço automático.",
    to: "/projects/$projectId/settings/identity",
  },
  {
    id: "repository",
    group: "Projeto",
    icon: "solar-[code-bold-duotone]",
    label: "Repositório e branch",
    description: "Escolha de onde vem o código publicado e configure o acesso ao repositório.",
    to: "/projects/$projectId/settings/repository",
  },
  {
    id: "team",
    group: "Projeto",
    icon: "solar-[users-group-rounded-bold-duotone]",
    label: "Equipe e permissões",
    description: "Gerencie quem tem acesso ao projeto e o que cada pessoa pode fazer.",
    to: "/projects/$projectId/settings/access/team",
    permission: "member:manage",
  },
  {
    id: "build",
    group: "Deploy e execução",
    icon: "solar-[box-bold-duotone]",
    label: "Build e Dockerfile",
    description:
      "Escolha como montar a imagem para o próximo deploy, com Dockerfile, Railpack ou Compose.",
    to: "/projects/$projectId/settings/build",
  },
  {
    id: "runtime",
    group: "Deploy e execução",
    icon: "solar-[pulse-2-bold-duotone]",
    label: "Porta, saúde e recursos",
    description:
      "Configure a porta, a verificação de saúde, a CPU, a memória e o número de réplicas.",
    to: "/projects/$projectId/settings/runtime",
  },
  {
    id: "automation",
    group: "Deploy e execução",
    icon: "solar-[bolt-bold-duotone]",
    label: "Deploys automáticos",
    description:
      "Configure a publicação automática, a reversão após falhas e os testes por pull request.",
    to: "/projects/$projectId/settings/automation",
  },
  {
    id: "staging",
    group: "Deploy e execução",
    icon: "solar-[layers-bold-duotone]",
    label: "Ambiente de staging",
    description: "Teste uma branch separada antes de publicar em produção.",
    to: "/projects/$projectId/settings/environments/staging",
  },
  {
    id: "volumes",
    group: "Infraestrutura",
    icon: "solar-[database-bold-duotone]",
    label: "Volumes e arquivos",
    description: "Escolha quais pastas devem manter os arquivos entre deploys.",
    to: "/projects/$projectId/settings/volumes",
  },
  {
    id: "server",
    group: "Infraestrutura",
    icon: "solar-[server-bold-duotone]",
    label: "Servidor do projeto",
    description: "Veja onde o projeto roda e revise o que é necessário para movê-lo.",
    to: "/projects/$projectId/settings/server",
    permission: "settings:write",
  },
  {
    id: "deletion",
    group: "Zona de risco",
    icon: "solar-[trash-bin-trash-bold-duotone]",
    label: "Excluir projeto",
    description: "Revise o que será removido antes de excluir o projeto permanentemente.",
    to: "/projects/$projectId/settings/deletion",
    permission: "project:delete",
  },
] as const;

export type ProjectSettingsSection = (typeof PROJECT_SETTINGS_SECTIONS)[number]["id"];
export type ProjectSettingsDestination = (typeof PROJECT_SETTINGS_SECTIONS)[number];

export const SETTINGS_HEADING_ID = "configuracoes";

export function projectSettingsDestination(section: ProjectSettingsSection) {
  return PROJECT_SETTINGS_SECTIONS.find((destination) => destination.id === section);
}

/** Resolves bookmarks from the former long form to their dedicated pages. */
export function legacySettingsDestination(hash: string) {
  const anchors: Readonly<Record<string, ProjectSettingsSection>> = {
    "settings-general": "identity",
    "settings-repository": "repository",
    "settings-access": "repository",
    "settings-build": "build",
    "settings-automation": "automation",
    "settings-volumes": "volumes",
    "settings-server": "server",
    "settings-danger": "deletion",
  };
  const anchor = hash.replace(/^#/, "");
  const id = Object.hasOwn(anchors, anchor) ? anchors[anchor] : undefined;
  return (
    PROJECT_SETTINGS_SECTIONS.find((section) => section.id === id)?.to ??
    "/projects/$projectId/settings"
  );
}

/** Offers only settings pages the current account may open. */
export function visibleSettingsSections(can: (permission: Permission) => boolean) {
  return PROJECT_SETTINGS_SECTIONS.filter(
    (section) => "permission" in section === false || can(section.permission),
  );
}
