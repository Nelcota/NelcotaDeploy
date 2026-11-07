import type { OrganizationSettingsSection } from "@/shared/schemas/settings/organization-settings.schema";
import { ErrorState, ListSkeleton } from "@/web/components/layout/states";

import { useSettings } from "../use-settings";
import { OrganizationForm } from "./organization-form";

const SKELETON_ROWS = 3;

/** Loads the saved settings for one independent administration form. */
export function OrganizationTab({
  canEdit,
  section,
}: {
  readonly canEdit: boolean;
  readonly section: OrganizationSettingsSection;
}) {
  const settings = useSettings();
  if (settings.isError) {
    return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;
  }
  if (settings.data == null) {
    return <ListSkeleton rows={SKELETON_ROWS} />;
  }
  return (
    <div className="space-y-10">
      <OrganizationForm
        key={section}
        section={section}
        initial={settings.data.settings}
        canEdit={canEdit}
        traefikEnabled={settings.data.server.traefikEnabled}
      />
    </div>
  );
}
