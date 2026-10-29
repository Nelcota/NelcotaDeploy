import { timingSafeEqual } from "node:crypto";

import { type CurrentUser, getCurrentUser } from "@/auth";
import { hasPermission } from "@/shared/roles";

/** Cookie that ties GitHub's callback to the browser that started the app creation. */
export const GITHUB_STATE_COOKIE = "nelcota_github_state";
const STATE_LIFETIME_IN_SECONDS = 600;
const HTTP_OK = 200;

/**
 * Renders a minimal standalone page, for the steps of the GitHub App flow that leave the app.
 *
 * @param page - Title, escaped body HTML and the extra CSP the page needs.
 * @returns The HTML response.
 */
export function standalonePage(page: {
  readonly title: string;
  readonly bodyHtml: string;
  readonly status?: number;
  readonly formAction?: string;
}): Response {
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${Bun.escapeHTML(page.title)} · Nelcota Deploy</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5">${page.bodyHtml}</body></html>`;
  const formAction = page.formAction ?? "'none'";
  return new Response(html, {
    status: page.status ?? HTTP_OK,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; form-action ${formAction}; base-uri 'none'; frame-ancestors 'none'`,
    },
  });
}

/**
 * Shows a failure in Portuguese with a way back to the settings.
 *
 * @param message - What went wrong, for the user.
 * @param status - HTTP status.
 * @returns The HTML response.
 */
export function failurePage(message: string, status: number): Response {
  return standalonePage({
    title: "GitHub",
    status,
    bodyHtml: `<h1>Não foi possível conectar ao GitHub</h1><p>${Bun.escapeHTML(message)}</p><p><a href="/settings?tab=server">Voltar para as configurações</a></p>`,
  });
}

/**
 * Returns the signed-in user when they may change settings.
 *
 * @param headers - Request headers with the session cookie.
 * @returns The user, or null when signed out or not allowed.
 */
export async function settingsEditor(headers: Headers): Promise<CurrentUser | null> {
  const user = await getCurrentUser(headers);
  if (user == null || hasPermission(user.role, "settings:write") === false) {
    return null;
  }
  return user;
}

/**
 * Builds the cookie that stores the state until GitHub calls back.
 *
 * @param state - Random state sent to GitHub.
 * @param secure - Whether the panel is served over HTTPS.
 * @returns The `Set-Cookie` value.
 */
export function stateCookie(state: string, secure: boolean): string {
  const attributes = `Path=/api/github/app; HttpOnly; SameSite=Lax; Max-Age=${STATE_LIFETIME_IN_SECONDS}`;
  return `${GITHUB_STATE_COOKIE}=${state}; ${attributes}${secure ? "; Secure" : ""}`;
}

/**
 * Compares the state GitHub sent back with the browser's cookie in constant time.
 *
 * @param received - State from the callback URL.
 * @param expected - State from the cookie.
 * @returns True when both are present and equal.
 */
export function isSameState(received: string | null, expected: string | null): boolean {
  if (received == null || expected == null || received === "") {
    return false;
  }
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}
