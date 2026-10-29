import { useQuery } from "@tanstack/react-query";
import { TriangleAlertIcon } from "lucide-react";

import { getGitHubPermissionGapsFn } from "@/web/functions/admin/github.functions";

// Permissions change only when someone accepts them on GitHub; checking every few minutes is enough.
const PERMISSION_STALE_IN_MS = 300_000;

/**
 * Warns when an installation of the app has not accepted the permissions for commit statuses
 * and pull request previews yet, which apps created before them need to do once.
 */
export function GitHubPermissionNotice({ appUrl }: { readonly appUrl: string }) {
  const gaps = useQuery({
    queryKey: ["github-permission-gaps"],
    queryFn: () => getGitHubPermissionGapsFn(),
    staleTime: PERMISSION_STALE_IN_MS,
    retry: false,
  });
  if (gaps.isError) {
    return (
      <p className="text-sm text-muted-foreground">
        Não foi possível conferir as permissões do app no GitHub agora.
      </p>
    );
  }
  const accounts = gaps.data ?? [];
  if (accounts.length === 0) {
    return null;
  }
  return (
    <p role="status" className="flex items-start gap-1.5 text-sm text-warning">
      <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>
        {accounts.join(", ")} ainda não liberou o status dos deploys e os previews de pull request.
        No GitHub, abra as configurações do{" "}
        <a href={appUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
          app
        </a>{" "}
        → Permissions & events, marque “Commit statuses: Read and write”, “Pull requests: Read-only”
        e o evento “Pull request”, e aceite a mudança na instalação.
      </span>
    </p>
  );
}
