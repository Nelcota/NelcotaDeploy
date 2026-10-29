import { ErrorState, ListSkeleton } from "@/web/components/layout/states";

import { useSettings } from "../use-settings";
import { HostUsageSection } from "./host-usage-section";
import { WebhookSection } from "./webhook-section";
import { WorkerSection } from "./worker-section";

const SKELETON_ROWS = 4;

/** Host resources, worker state and the GitHub webhook setup. */
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
      <HostUsageSection host={server.hostSample} />
      <WorkerSection server={server} />
      <WebhookSection webhookUrl={server.webhookUrl} webhookConfigured={server.webhookConfigured} />
    </div>
  );
}
