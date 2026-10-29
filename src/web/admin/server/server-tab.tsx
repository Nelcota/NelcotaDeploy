import { ErrorState, ListSkeleton } from "@/web/components/layout/states";

import { useSettings } from "../use-settings";
import { WebhookSection } from "./webhook-section";
import { WorkerSection } from "./worker-section";

const SKELETON_ROWS = 4;

/** Worker state and the GitHub webhook setup. */
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
      <WebhookSection webhookUrl={server.webhookUrl} webhookConfigured={server.webhookConfigured} />
    </div>
  );
}
