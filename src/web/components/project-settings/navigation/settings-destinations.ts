import type { Permission } from "@/shared/roles";

const PROJECT_SETTINGS_SECTIONS = [
  {
    id: "identity",
    label: "Nome e identificador do projeto",
    to: "/projects/$projectId/settings/identity",
  },
  {
    id: "repository",
    label: "Repositório do código",
    to: "/projects/$projectId/settings/repository",
  },
  { id: "build", label: "Construção da imagem", to: "/projects/$projectId/settings/build" },
  {
    id: "runtime",
    label: "Porta e verificação de saúde",
    to: "/projects/$projectId/settings/runtime",
  },
  {
    id: "automation",
    label: "Automação de deploys",
    to: "/projects/$projectId/settings/automation",
  },
  {
    id: "volumes",
    label: "Armazenamento persistente",
    to: "/projects/$projectId/settings/volumes",
  },
  {
    id: "server",
    label: "Trocar servidor",
    to: "/projects/$projectId/settings/server",
    permission: "settings:write",
  },
  {
    id: "deletion",
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
  const id = anchors[hash.replace(/^#/, "")] ?? "identity";
  return (
    PROJECT_SETTINGS_SECTIONS.find((section) => section.id === id)?.to ??
    "/projects/$projectId/settings/identity"
  );
}

/** Offers only settings pages the current account may open. */
export function visibleSettingsSections(can: (permission: Permission) => boolean) {
  return PROJECT_SETTINGS_SECTIONS.filter(
    (section) => "permission" in section === false || can(section.permission),
  );
}
