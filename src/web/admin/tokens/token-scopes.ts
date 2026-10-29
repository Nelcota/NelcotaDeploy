import { EyeIcon, type LucideIcon, RocketIcon } from "lucide-react";

export type TokenScope = "read" | "deploy";

/** Every scope a token can hold, with how it is shown. */
export const SCOPES: readonly {
  readonly value: TokenScope;
  readonly label: string;
  readonly description: string;
  readonly icon: LucideIcon;
}[] = [
  {
    value: "read",
    label: "Leitura",
    description: "Consultar projetos, deploys, logs e métricas.",
    icon: EyeIcon,
  },
  {
    value: "deploy",
    label: "Deploy",
    description: "Disparar deploys e reiniciar contêineres.",
    icon: RocketIcon,
  },
];

/**
 * Adds or removes one scope from a selection, keeping the others in their order.
 *
 * @param scopes - Scopes selected so far.
 * @param scope - Scope whose checkbox changed.
 * @param checked - Whether the checkbox is now checked.
 * @returns The new selection.
 */
export function toggleScope(
  scopes: readonly TokenScope[],
  scope: TokenScope,
  checked: boolean,
): TokenScope[] {
  if (checked) {
    return [...scopes, scope];
  }
  return scopes.filter((value) => value !== scope);
}
