import { GitBranchIcon } from "lucide-react";

import { Section } from "@/web/components/layout/layout";
import { useCan } from "@/web/components/shell/use-permissions";

import type { ServerData } from "../server-data";
import { ConnectGitHubApp } from "./github-app-connect";
import { ConnectedGitHubApp } from "./github-app-connected";

/** The GitHub App that lists repositories, clones private ones and delivers pushes. */
export function GitHubAppSection({ server }: { readonly server: ServerData }) {
  const can = useCan();
  return (
    <Section icon={GitBranchIcon} title="GitHub">
      {server.githubApp == null ? (
        <ConnectGitHubApp canEdit={can("settings:write")} server={server} />
      ) : (
        <ConnectedGitHubApp app={server.githubApp} canEdit={can("settings:write")} />
      )}
    </Section>
  );
}
