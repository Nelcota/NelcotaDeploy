import { PlusIcon } from "lucide-react";
import { type FormEvent, useState } from "react";

import {
  MAX_VOLUMES_PER_PROJECT,
  mountPathsOverlap,
  volumeInputSchema,
} from "@/shared/schemas/volume.schema";
import { toUserMessage } from "@/web/components/layout/error-message";
import { ErrorState } from "@/web/components/layout/states";
import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";

import { useVolumeDiscovery } from "./use-volume-discovery";
import { VolumeReviewDialog } from "./volume-review-dialog";
import { availableVolumePaths } from "./volume-suggestions";

export function AddVolumeForm({
  projectId,
  volumes,
  pending,
  onAdd,
}: {
  readonly projectId: string;
  readonly volumes: readonly { readonly mountPath: string }[];
  readonly pending: boolean;
  readonly onAdd: (input: {
    readonly mountPath: string;
    readonly expectedServerId: string;
  }) => Promise<unknown>;
}) {
  const { discovery, project, servers, server } = useVolumeDiscovery(projectId);
  const [customPath, setCustomPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState<{
    readonly mountPath: string;
    readonly expectedServerId: string;
    readonly serverName: string;
  } | null>(null);
  const paths = availableVolumePaths(
    discovery.isError ? [] : (discovery.data?.paths ?? []),
    volumes,
  );
  const mountPath = customPath ?? (paths.length === 1 ? (paths.at(0) ?? "") : "");
  const limited = volumes.length >= MAX_VOLUMES_PER_PROJECT;
  const configurationError = project.error ?? servers.error;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (pending || limited || server == null || configurationError != null) {
      return;
    }
    const parsed = volumeInputSchema.safeParse({ mountPath });
    if (parsed.success === false) {
      setError(parsed.error.issues.at(0)?.message ?? "Caminho inválido");
      return;
    }
    if (volumes.some((volume) => mountPathsOverlap(volume.mountPath, parsed.data.mountPath))) {
      setError("Este caminho já existe ou se sobrepõe a outro volume, inclusive desanexado.");
      return;
    }
    setError(null);
    setReviewed({
      mountPath: parsed.data.mountPath,
      expectedServerId: server.id,
      serverName: server.name,
    });
  };
  const confirm = async () => {
    if (reviewed == null || pending) {
      return;
    }
    try {
      await onAdd(reviewed);
      setReviewed(null);
      setCustomPath(null);
      setError(null);
    } catch (failure) {
      setError(
        toUserMessage(
          failure,
          "Não foi possível adicionar o volume. Confira a configuração e tente novamente.",
        ),
      );
    }
  };
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Pastas detectadas no Dockerfile</p>
      {discovery.isFetching ? (
        <p role="status" className="text-xs text-muted-foreground">
          Lendo o Dockerfile do projeto…
        </p>
      ) : null}
      {discovery.isError ? (
        <ErrorState error={discovery.error} onRetry={() => void discovery.refetch()} />
      ) : null}
      {discovery.data?.source == null ? null : (
        <p className="text-xs text-muted-foreground">
          {discovery.data.source.path} · {discovery.data.branch}. Caminhos já configurados ou
          sobrepostos não serão sugeridos.
        </p>
      )}
      {discovery.data?.limited === true ? (
        <p className="text-xs text-warning">
          A descoberta é parcial. Caminhos dinâmicos e sintaxe não suportada exigem revisão manual.
        </p>
      ) : null}
      {discovery.isFetching === false && discovery.isError === false && paths.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nenhum novo caminho literal disponível. Você ainda pode informar uma pasta.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {paths.map((path) => (
          <Button
            type="button"
            variant="outline"
            size="sm"
            key={path}
            onClick={() => {
              setCustomPath(path);
              setError(null);
            }}
          >
            {path}
          </Button>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={discovery.isFetching}
          onClick={() => void discovery.refetch()}
        >
          Detectar pastas persistentes novamente
        </Button>
      </div>
      {configurationError == null ? null : (
        <ErrorState
          error={configurationError}
          onRetry={() => {
            void project.refetch();
            void servers.refetch();
          }}
        />
      )}
      <form
        aria-label="Adicionar volume"
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={submit}
        noValidate
      >
        <div className="flex-1 space-y-2">
          <Label htmlFor="volume-path">Caminho no contêiner</Label>
          <Input
            id="volume-path"
            className="font-mono"
            placeholder="/app/data"
            aria-invalid={error != null}
            aria-describedby="volume-path-error"
            value={mountPath}
            onChange={(event) => {
              setCustomPath(event.target.value);
              setError(null);
            }}
          />
          <p id="volume-path-error" role="alert" className="text-sm text-destructive empty:hidden">
            {error}
          </p>
        </div>
        <Button
          type="submit"
          disabled={
            pending ||
            limited ||
            mountPath.trim() === "" ||
            server == null ||
            configurationError != null
          }
        >
          <PlusIcon aria-hidden />
          Revisar volume
        </Button>
      </form>
      {limited ? (
        <p className="text-sm text-warning">
          O projeto já atingiu o limite de {MAX_VOLUMES_PER_PROJECT} volumes, incluindo desanexados.
        </p>
      ) : null}
      {reviewed == null ? null : (
        <VolumeReviewDialog
          {...reviewed}
          pending={pending}
          error={error}
          onClose={() => {
            setReviewed(null);
            setError(null);
          }}
          onConfirm={() => void confirm()}
        />
      )}
    </div>
  );
}
