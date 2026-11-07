import { HardDriveIcon } from "lucide-react";

import { ErrorState, ListSkeleton } from "@/web/components/layout/states";

import { SettingsSection } from "../settings-section";
import { AddVolumeForm } from "./add-volume-form";
import { useVolumes } from "./use-volumes";
import { VolumeRow } from "./volume-row";

/** Folders of the container kept between deployments, on the project's server. */
export function VolumesSection({
  projectId,
  canEdit,
  canDeleteData,
}: {
  readonly projectId: string;
  readonly canEdit: boolean;
  readonly canDeleteData: boolean;
}) {
  const { volumes, add, toggle, deleteData } = useVolumes(projectId);
  if (volumes.isError) {
    return <ErrorState error={volumes.error} onRetry={() => void volumes.refetch()} />;
  }
  if (volumes.data == null) {
    return <ListSkeleton rows={2} />;
  }
  const list = volumes.data;
  const busy = toggle.isPending || deleteData.isPending;
  return (
    <SettingsSection
      id="settings-volumes"
      icon={HardDriveIcon}
      title="Armazenamento persistente"
      description="Pastas do contêiner que guardam arquivos entre deploys, no disco do servidor do projeto."
    >
      <div className="space-y-4">
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum volume. Sem eles, arquivos gravados pela aplicação somem a cada deploy.
          </p>
        ) : (
          <ul className="divide-y divide-border/70">
            {list.map((volume) => (
              <VolumeRow
                key={volume.id}
                volume={volume}
                canEdit={canEdit}
                canDeleteData={canDeleteData}
                busy={busy}
                onToggle={(attached) => toggle.mutate({ volumeId: volume.id, attached })}
                onDeleteData={() => deleteData.mutate(volume.id)}
              />
            ))}
          </ul>
        )}
        {canEdit ? (
          <AddVolumeForm
            projectId={projectId}
            volumes={list}
            pending={add.isPending}
            onAdd={async (input) => await add.mutateAsync(input)}
          />
        ) : null}
      </div>
    </SettingsSection>
  );
}
