import { createFileRoute } from "@tanstack/react-router";

import { getConfig } from "@/config";
import { appRegistrationUrl, buildAppManifest, isGitHubAccountName } from "@/github";
import {
  failurePage,
  settingsEditor,
  standalonePage,
  stateCookie,
} from "@/web/server/github-app-pages";

const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;

/**
 * Starts the GitHub App creation: posts the manifest to GitHub, which shows the app for the
 * user to confirm and then calls back with a code.
 */
export const Route = createFileRoute("/api/github/app/new")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await settingsEditor(request.headers);
        if (user == null) {
          return failurePage("Só administradores podem conectar o GitHub.", HTTP_FORBIDDEN);
        }
        const organization = new URL(request.url).searchParams.get("organization")?.trim() ?? "";
        if (organization !== "" && isGitHubAccountName(organization) === false) {
          return failurePage("Nome de organização inválido.", HTTP_BAD_REQUEST);
        }
        const { PUBLIC_URL: publicUrl } = getConfig();
        const state = crypto.randomUUID();
        const action = appRegistrationUrl(organization === "" ? null : organization, state);
        const manifest = Bun.escapeHTML(JSON.stringify(buildAppManifest(publicUrl)));
        const response = standalonePage({
          title: "Criar app no GitHub",
          formAction: "https://github.com",
          bodyHtml: `<form id="manifest" method="post" action="${Bun.escapeHTML(action)}"><input type="hidden" name="manifest" value="${manifest}"><p>Abrindo o GitHub para criar o app…</p><button type="submit">Continuar no GitHub</button></form><script>document.getElementById("manifest").submit();</script>`,
        });
        response.headers.append("Set-Cookie", stateCookie(state, publicUrl.startsWith("https://")));
        return response;
      },
    },
  },
});
