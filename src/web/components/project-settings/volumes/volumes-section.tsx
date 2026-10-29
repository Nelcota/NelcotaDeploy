import { HardDriveIcon, PlusIcon } from "lucide-react";
import { type FormEvent, useState } from "react";

import { volumeInputSchema } from "@/shared/schemas/volume.schema";
import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";

import { SettingsSection } from "../settings-section";
import { useVolumes } from "./use-volumes";
import { VolumeRow } from "./volume-row";

const ERROR_ID = "volume-path-error";

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
  const list = volumes.data ?? [];
  const busy = toggle.isPending || deleteData.isPending;
  return (
    <SettingsSection
      icon={HardDriveIcon}
      title="Volumes"
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
          <AddVolumeForm pending={add.isPending} onAdd={(path) => add.mutate(path)} />
        ) : null}
      </div>
    </SettingsSection>
  );
}

function AddVolumeForm({
  pending,
  onAdd,
}: {
  readonly pending: boolean;
  readonly onAdd: (mountPath: string) => void;
}) {
  const [mountPath, setMountPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = volumeInputSchema.safeParse({ mountPath });
    if (parsed.success === false) {
      setError(parsed.error.issues[0]?.message ?? "Caminho inválido");
      return;
    }
    setError(null);
    onAdd(parsed.data.mountPath);
    setMountPath("");
  };
  return (
    <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={submit} noValidate>
      <div className="flex-1 space-y-2">
        <Label htmlFor="volume-path">Caminho no contêiner</Label>
        <Input
          id="volume-path"
          className="font-mono"
          placeholder="/app/data"
          aria-invalid={error != null}
          aria-describedby={error == null ? undefined : ERROR_ID}
          value={mountPath}
          onChange={(event) => setMountPath(event.target.value)}
        />
        {error == null ? null : (
          <p id={ERROR_ID} role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <Button type="submit" disabled={pending || mountPath.trim() === ""}>
        <PlusIcon aria-hidden />
        Adicionar volume
      </Button>
    </form>
  );
}
