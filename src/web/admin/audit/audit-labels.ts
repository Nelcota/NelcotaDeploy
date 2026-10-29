import {
  BoxesIcon,
  ClockIcon,
  ContainerIcon,
  GlobeIcon,
  HistoryIcon,
  KeyRoundIcon,
  type LucideIcon,
  RocketIcon,
  ServerIcon,
  UserRoundIcon,
  UsersIcon,
  VariableIcon,
  WebhookIcon,
} from "lucide-react";

const ACTOR_TYPES: Record<string, { readonly label: string; readonly icon: LucideIcon }> = {
  user: { label: "Usuário", icon: UserRoundIcon },
  token: { label: "Token", icon: KeyRoundIcon },
  webhook: { label: "Webhook", icon: WebhookIcon },
  system: { label: "Sistema", icon: ServerIcon },
};

/** Icon of each audited area, the part of the action code before the dot. */
const AREA_ICONS: Record<string, LucideIcon> = {
  deployment: RocketIcon,
  environment_variable: VariableIcon,
  domain: GlobeIcon,
  task: ClockIcon,
  project: BoxesIcon,
  user: UsersIcon,
  api_token: KeyRoundIcon,
  container: ContainerIcon,
};

const TARGET_TYPE_LABELS: Record<string, string> = {
  task: "Task",
  project: "Projeto",
  deployment: "Deploy",
  user: "Usuário",
  api_token: "Token",
  domain: "Domínio",
  environment_variable: "Variável",
  container: "Contêiner",
};

/**
 * Describes the area of an audit action, the part before the dot.
 *
 * @param action - Action code such as "deployment.requested".
 * @returns The area icon, or a generic history icon for unknown areas.
 */
export function areaOf(action: string): { readonly icon: LucideIcon } {
  const area = action.split(".")[0] ?? "";
  return { icon: AREA_ICONS[area] ?? HistoryIcon };
}

/**
 * Describes who performed an audited action.
 *
 * @param actorType - Actor type stored with the event, such as "user" or "webhook".
 * @returns Its label in Portuguese and icon, falling back to the raw type and a person icon.
 */
export function actorOf(actorType: string): { readonly label: string; readonly icon: LucideIcon } {
  return ACTOR_TYPES[actorType] ?? { label: actorType, icon: UserRoundIcon };
}

/**
 * Names the kind of record an audited action touched.
 *
 * @param targetType - Target type stored with the event.
 * @returns Its label in Portuguese, or the raw type when unknown.
 */
export function targetTypeLabelOf(targetType: string): string {
  return TARGET_TYPE_LABELS[targetType] ?? targetType;
}
