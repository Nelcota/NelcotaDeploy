import { useSettings } from "@/web/admin/use-settings";
import { ErrorState, ListSkeleton } from "@/web/components/layout/states";

import { GitHubAppSection } from "./github-app-section";

/** Loads the GitHub integration without rendering the system health page. */
export function GitHubPage() {
  const settings = useSettings();
  if (settings.isError) {
    return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;
  }
  if (settings.data == null) {
    return <ListSkeleton rows={1} />;
  }
  return <GitHubAppSection server={settings.data.server} />;
}
