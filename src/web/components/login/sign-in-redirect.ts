const GITHUB_ERRORS: Readonly<Record<string, string>> = {
  signup_disabled:
    "Não há conta no painel com o e-mail do seu GitHub. Peça acesso a um administrador.",
  account_not_linked:
    "O e-mail do seu GitHub não está verificado lá. Verifique-o no GitHub ou entre com e-mail e senha.",
  email_not_found: "O GitHub não informou o seu e-mail. Entre com e-mail e senha.",
};

/**
 * Picks where to go after signing in. Only same-site paths are followed, never full URLs, so a
 * crafted link cannot send someone to another site.
 *
 * @param target - The `redirect` of the login page address.
 * @returns A path on the panel; the dashboard when the target is missing or unsafe.
 */
export function safeRedirectTarget(target: string | undefined): string {
  if (target == null || target.startsWith("/") === false || target.startsWith("//")) {
    return "/";
  }
  return target;
}

/**
 * Explains, in Portuguese, why signing in with GitHub failed.
 *
 * @param code - The `error` Better Auth puts in the login address.
 * @returns The message to show.
 */
export function githubSignInErrorMessage(code: string): string {
  return GITHUB_ERRORS[code] ?? "Não foi possível entrar com o GitHub. Tente novamente.";
}
