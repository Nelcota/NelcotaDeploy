import { ErrorState, ListSkeleton } from "@/web/components/layout/states";

import { useSettings } from "../use-settings";
import { GitHubAppSection } from "./github-app-section";
import { WorkerSection } from "./worker-section";

const SKELETON_ROWS = 4;

/** Worker state and the GitHub connection. */
export function ServerTab() {
  const settings = useSettings();
  if (settings.isError) {
    return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;
  }
  if (settings.data == null) {
    return <ListSkeleton rows={SKELETON_ROWS} />;
  }
  const { server } = settings.data;
  return (
    <div className="space-y-10">
      <WorkerSection server={server} />
      <GitHubAppSection server={server} />
    </div>
  );
}
