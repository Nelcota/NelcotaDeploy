import { createFileRoute } from "@tanstack/react-router";

import { userActor } from "@/auth";
import { getDatabase } from "@/db";
import { convertManifestCode, GITHUB_API, saveGitHubApp } from "@/github";
import { createLogger } from "@/logging";
import { getSecretBox } from "@/secrets";
import {
  failurePage,
  GITHUB_STATE_COOKIE,
  isSameState,
  settingsEditor,
} from "@/web/server/github-app-pages";
import { refreshGitHubLogin } from "@/web/server/github-login";

const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_BAD_GATEWAY = 502;
const HTTP_SEE_OTHER = 303;

/**
 * Receives the code of the app the user just created on GitHub, stores the app's credentials
 * and sends the user on to choose the repositories it can read.
 */
export const Route = createFileRoute("/api/github/app/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await settingsEditor(request.headers);
        if (user == null) {
          return failurePage("Só administradores podem conectar o GitHub.", HTTP_FORBIDDEN);
        }
        const parameters = new URL(request.url).searchParams;
        const cookies = new Bun.CookieMap(request.headers.get("cookie") ?? "");
        if (isSameState(parameters.get("state"), cookies.get(GITHUB_STATE_COOKIE)) === false) {
          return failurePage(
            "O pedido expirou. Comece de novo pelas configurações.",
            HTTP_BAD_REQUEST,
          );
        }
        try {
          const app = await convertManifestCode(GITHUB_API, parameters.get("code") ?? "");
          const summary = await saveGitHubApp(getDatabase(), await getSecretBox(), {
            app,
            actor: userActor(user),
          });
          await refreshGitHubLogin();
          return new Response(null, {
            status: HTTP_SEE_OTHER,
            headers: {
              Location: summary.installUrl,
              "Set-Cookie": `${GITHUB_STATE_COOKIE}=; Path=/api/github/app; Max-Age=0`,
            },
          });
        } catch (error) {
          createLogger("github-app").error({ err: error }, "github app creation failed");
          return failurePage("O GitHub não confirmou o app. Tente novamente.", HTTP_BAD_GATEWAY);
        }
      },
    },
  },
});
