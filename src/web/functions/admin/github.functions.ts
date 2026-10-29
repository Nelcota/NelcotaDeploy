import { createServerFn } from "@tanstack/react-start";

import { userActor } from "@/auth";
import { getDatabase } from "@/db";
import { removeGitHubApp } from "@/github";
import { authorize } from "@/web/server/authorization";

/** Forgets the GitHub App; it stays on GitHub until deleted there. */
export const disconnectGitHubAppFn = createServerFn({ method: "POST" }).handler(async () => {
  const user = await authorize("settings:write");
  removeGitHubApp(getDatabase(), userActor(user));
});
