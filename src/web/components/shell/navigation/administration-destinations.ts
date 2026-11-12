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
    description: "Altere o nome exibido no painel.",
    icon: Building2Icon,
    solarIcon: "solar-[buildings-2-bold-duotone]",
    permission: null,
  },
  {
    tab: "domains",
    group: "Organização",
    to: "/settings/domains",
    label: "Domínios automáticos",
    description: "Defina os domínios usados ao publicar projetos.",
    icon: GlobeIcon,
    solarIcon: "solar-[global-bold-duotone]",
    permission: null,
  },
  {
    tab: "alerts",
    group: "Organização",
    to: "/settings/alerts",
    label: "Notificações por webhook",
    description: "Configure para onde o painel envia avisos de deploy.",
    icon: BellIcon,
    solarIcon: "solar-[bell-bold-duotone]",
    permission: null,
  },
  {
    tab: "users",
    group: "Acesso e auditoria",
    to: "/settings/users",
    label: "Usuários",
    description: "Gerencie contas e permissões de acesso.",
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
    description: "Confira o estado do worker, do Docker e do proxy.",
    icon: ActivityIcon,
    solarIcon: "solar-[pulse-2-bold-duotone]",
    permission: null,
  },
  {
    tab: "github",
    group: "Integrações",
    to: "/settings/integrations/github",
    label: "Conexão com o GitHub",
    description: "Conecte a aplicação do GitHub para acessar repositórios.",
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
    description: "Confira os eventos recebidos e o resultado do processamento.",
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
