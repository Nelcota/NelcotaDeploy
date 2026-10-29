import { createServerFn } from "@tanstack/react-start";

import { userActor } from "@/auth";
import { getDatabase } from "@/db";
import { accountsMissingStatusPermission, removeGitHubApp } from "@/github";
import { getSecretBox } from "@/secrets";
import { authorize } from "@/web/server/authorization";
import { refreshGitHubLogin } from "@/web/server/github-login";

/** Forgets the GitHub App; it stays on GitHub until deleted there. */
export const disconnectGitHubAppFn = createServerFn({ method: "POST" }).handler(async () => {
  const user = await authorize("settings:write");
  removeGitHubApp(getDatabase(), userActor(user));
  await refreshGitHubLogin();
});

/** Accounts whose installation of the app has not accepted the commit status permission. */
export const getGitHubPermissionGapsFn = createServerFn({ method: "GET" }).handler(async () => {
  await authorize("settings:write");
  return await accountsMissingStatusPermission(getDatabase(), await getSecretBox());
});
