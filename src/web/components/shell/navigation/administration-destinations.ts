import {
  ActivityIcon,
  BellIcon,
  Building2Icon,
  CloudIcon,
  GlobeIcon,
  KeyRoundIcon,
  type LucideIcon,
  ServerIcon,
  ShieldIcon,
  UsersIcon,
  WebhookIcon,
} from "lucide-react";

import type { Permission } from "@/shared/roles";
import { GitHubIcon } from "@/web/components/github/github.icon";

/** Independent administration pages; `tab` also resolves bookmarks from the former tabbed page. */
export const SETTINGS_SECTIONS = [
  {
    tab: "organization",
    group: "Organização",
    to: "/settings/organization",
    label: "Nome da organização",
    icon: Building2Icon,
    permission: null,
  },
  {
    tab: "domains",
    group: "Organização",
    to: "/settings/domains",
    label: "Domínios automáticos",
    icon: GlobeIcon,
    permission: null,
  },
  {
    tab: "alerts",
    group: "Organização",
    to: "/settings/alerts",
    label: "Notificações por webhook",
    icon: BellIcon,
    permission: null,
  },
  {
    tab: "users",
    group: "Acesso e auditoria",
    to: "/settings/users",
    label: "Usuários",
    icon: UsersIcon,
    permission: "user:manage",
  },
  {
    tab: "servers",
    group: "Infraestrutura",
    to: "/settings/servers",
    label: "Servidores de deploy",
    icon: ServerIcon,
    permission: null,
  },
  {
    tab: "server",
    group: "Infraestrutura",
    to: "/settings/system",
    label: "Estado do sistema",
    icon: ActivityIcon,
    permission: null,
  },
  {
    tab: "github",
    group: "Integrações",
    to: "/settings/integrations/github",
    label: "Conexão com o GitHub",
    icon: GitHubIcon,
    permission: null,
  },
  {
    tab: "cloudflare",
    group: "Integrações",
    to: "/settings/integrations/cloudflare",
    label: "Conexão com a Cloudflare",
    icon: CloudIcon,
    permission: null,
  },
  {
    tab: "tokens",
    group: "Acesso e auditoria",
    to: "/settings/tokens",
    label: "Tokens de acesso à API",
    icon: KeyRoundIcon,
    permission: "token:manage",
  },
  {
    tab: "audit",
    group: "Acesso e auditoria",
    to: "/settings/audit",
    label: "Histórico de ações",
    icon: ShieldIcon,
    permission: "audit:read",
  },
  {
    tab: "webhooks",
    group: "Integrações",
    to: "/settings/webhooks",
    label: "Webhooks recebidos do GitHub",
    icon: WebhookIcon,
    permission: "audit:read",
  },
] as const satisfies readonly {
  readonly tab: string;
  readonly group: string;
  readonly to: `/settings/${string}`;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly permission: Permission | null;
}[];

/** Resolves old administration bookmarks without exposing a restricted destination. */
export function legacyAdministrationDestination(
  tab: string | undefined,
  permissions: readonly Permission[],
) {
  const section = SETTINGS_SECTIONS.find((item) => item.tab === tab);
  if (
    section == null ||
    (section.permission != null && permissions.includes(section.permission) === false)
  ) {
    return "/settings/organization";
  }
  return section.to;
}
