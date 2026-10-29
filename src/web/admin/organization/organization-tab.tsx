import { ErrorState, ListSkeleton } from "@/web/components/layout/states";

import { useSettings } from "../use-settings";
import { OrganizationForm } from "./organization-form";

const SKELETON_ROWS = 3;

/** Organization name, base domain and HTTPS default, editable by admins. */
export function OrganizationTab({ canEdit }: { readonly canEdit: boolean }) {
  const settings = useSettings();
  if (settings.isError) {
    return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;
  }
  if (settings.data == null) {
    return <ListSkeleton rows={SKELETON_ROWS} />;
  }
  return (
    <OrganizationForm
      // A new key after saving resets the form to the saved values, so "changed" clears.
      key={JSON.stringify(settings.data.settings)}
      initial={settings.data.settings}
      canEdit={canEdit}
      traefikEnabled={settings.data.server.traefikEnabled}
    />
  );
}
