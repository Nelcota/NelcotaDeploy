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
    label: "Organização e segurança",
    description:
      "Altere o nome no painel e defina se administradores precisam usar verificação em duas etapas (2FA).",
    icon: Building2Icon,
    solarIcon: "solar-[buildings-2-bold-duotone]",
    permission: null,
  },
  {
    tab: "domains",
    group: "Organização",
    to: "/settings/domains",
    label: "Domínios automáticos",
    description:
      "Escolha o domínio base e configure HTTPS para os endereços automáticos dos projetos.",
    icon: GlobeIcon,
    solarIcon: "solar-[global-bold-duotone]",
    permission: null,
  },
  {
    tab: "alerts",
    group: "Organização",
    to: "/settings/alerts",
    label: "Alertas de deploy e servidor",
    description:
      "Envie avisos ao Discord ou Slack quando um deploy falhar ou um servidor cair ou voltar.",
    icon: BellIcon,
    solarIcon: "solar-[bell-bold-duotone]",
    permission: null,
  },
  {
    tab: "users",
    group: "Acesso e auditoria",
    to: "/settings/users",
    label: "Usuários e permissões",
    description: "Crie contas, altere permissões e redefina senhas de acesso ao painel.",
    icon: UsersIcon,
    solarIcon: "solar-[users-group-rounded-bold-duotone]",
    permission: "user:manage",
  },
  {
    tab: "servers",
    group: "Infraestrutura",
    to: "/settings/servers",
    label: "Servidores de deploy",
    description: "Conecte servidores e acompanhe seu estado.",
    icon: ServerIcon,
    solarIcon: "solar-[server-bold-duotone]",
    permission: null,
  },
  {
    tab: "server",
    group: "Infraestrutura",
    to: "/settings/system",
    label: "Estado do sistema",
    description: "Confira o worker, o Docker, o Traefik e os backups do painel.",
    icon: ActivityIcon,
    solarIcon: "solar-[pulse-2-bold-duotone]",
    permission: null,
  },
  {
    tab: "github",
    group: "Integrações",
    to: "/settings/integrations/github",
    label: "Conexão com o GitHub",
    description: "Conecte o GitHub App para acessar repositórios e receber eventos.",
    icon: GitHubIcon,
    solarIcon: "solar-[code-square-bold-duotone]",
    permission: null,
  },
  {
    tab: "cloudflare",
    group: "Integrações",
    to: "/settings/integrations/cloudflare",
    label: "Conexão com a Cloudflare",
    description: "Conecte a Cloudflare para gerenciar registros DNS.",
    icon: CloudIcon,
    solarIcon: "solar-[cloud-bold-duotone]",
    permission: null,
  },
  {
    tab: "tokens",
    group: "Acesso e auditoria",
    to: "/settings/tokens",
    label: "Tokens de acesso à API",
    description: "Crie e revogue tokens usados por automações.",
    icon: KeyRoundIcon,
    solarIcon: "solar-[key-bold-duotone]",
    permission: "token:manage",
  },
  {
    tab: "audit",
    group: "Acesso e auditoria",
    to: "/settings/audit",
    label: "Histórico de ações",
    description: "Consulte quem fez alterações no painel e quando.",
    icon: ShieldIcon,
    solarIcon: "solar-[shield-check-bold-duotone]",
    permission: "audit:read",
  },
  {
    tab: "webhooks",
    group: "Integrações",
    to: "/settings/webhooks",
    label: "Webhooks recebidos do GitHub",
    description:
      "Veja os eventos enviados pelo GitHub e confira se o painel conseguiu processá-los.",
    icon: WebhookIcon,
    solarIcon: "solar-[link-bold-duotone]",
    permission: "audit:read",
  },
] as const satisfies readonly {
  readonly tab: string;
  readonly group: string;
  readonly to: `/settings/${string}`;
  readonly label: string;
  readonly description: string;
  readonly icon: LucideIcon;
  readonly solarIcon: string;
  readonly permission: Permission | null;
}[];

export type AdministrationSection = (typeof SETTINGS_SECTIONS)[number];

/** Lists sections whose content the current account can open. */
export function visibleAdministrationSections(can: (permission: Permission) => boolean) {
  return SETTINGS_SECTIONS.filter(
    (section) => section.permission == null || can(section.permission),
  );
}

/** Resolves old administration bookmarks without exposing a restricted destination. */
export function legacyAdministrationDestination(
  tab: string | undefined,
  permissions: readonly Permission[],
) {
  const section = visibleAdministrationSections((permission) =>
    permissions.includes(permission),
  ).find((item) => item.tab === tab);
  return section?.to ?? "/settings/organization";
}
