import type { Permission } from "@/shared/roles";

const PROJECT_SETTINGS_SECTIONS = [
  {
    id: "identity",
    group: "Projeto",
    icon: "solar-[folder-2-bold-duotone]",
    label: "Nome e identificador do projeto",
    to: "/projects/$projectId/settings/identity",
  },
  {
    id: "repository",
    group: "Projeto",
    icon: "solar-[code-bold-duotone]",
    label: "Repositório do código",
    to: "/projects/$projectId/settings/repository",
  },
  {
    id: "build",
    group: "Deploy e execução",
    icon: "solar-[box-bold-duotone]",
    label: "Construção da imagem",
    to: "/projects/$projectId/settings/build",
  },
  {
    id: "runtime",
    group: "Deploy e execução",
    icon: "solar-[pulse-2-bold-duotone]",
    label: "Porta e verificação de saúde",
    to: "/projects/$projectId/settings/runtime",
  },
  {
    id: "automation",
    group: "Deploy e execução",
    icon: "solar-[bolt-bold-duotone]",
    label: "Automação de deploys",
    to: "/projects/$projectId/settings/automation",
  },
  {
    id: "volumes",
    group: "Infraestrutura",
    icon: "solar-[database-bold-duotone]",
    label: "Armazenamento persistente",
    to: "/projects/$projectId/settings/volumes",
  },
  {
    id: "server",
    group: "Infraestrutura",
    icon: "solar-[server-bold-duotone]",
    label: "Trocar servidor",
    to: "/projects/$projectId/settings/server",
    permission: "settings:write",
  },
  {
    id: "staging",
    group: "Deploy e execução",
    icon: "solar-[layers-bold-duotone]",
    label: "Ambiente de staging",
    to: "/projects/$projectId/settings/environments/staging",
  },
  {
    id: "team",
    group: "Projeto",
    icon: "solar-[users-group-rounded-bold-duotone]",
    label: "Equipe do projeto",
    to: "/projects/$projectId/settings/access/team",
    permission: "member:manage",
  },
  {
    id: "deletion",
    group: "Zona de risco",
    icon: "solar-[trash-bin-trash-bold-duotone]",
    label: "Excluir projeto",
    to: "/projects/$projectId/settings/deletion",
    permission: "project:delete",
  },
] as const;

export type ProjectSettingsSection = (typeof PROJECT_SETTINGS_SECTIONS)[number]["id"];

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
