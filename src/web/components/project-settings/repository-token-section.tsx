import { useQuery } from "@tanstack/react-query";
import {
  CircleCheckIcon,
  CircleDashedIcon,
  KeyRoundIcon,
  SaveIcon,
  Trash2Icon,
} from "lucide-react";
import { type FormEvent, useState } from "react";

import { ConfirmDialog } from "@/web/components/layout/confirm-dialog";
import { toUserMessage } from "@/web/components/layout/error-message";
import { Tag } from "@/web/components/layout/layout";
import { useAction } from "@/web/components/layout/use-action";
import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";
import { setRepositoryTokenFn } from "@/web/functions/projects.functions";
import { getRepositoryAccessFn } from "@/web/functions/repository/repository.functions";

import { SettingsSection } from "./settings-section";

function useRepositoryToken(projectId: string) {
  const [token, setToken] = useState("");
  const save = useAction({
    action: (value: string | null) => setRepositoryTokenFn({ data: { projectId, token: value } }),
    successMessage: (_result) => "Credencial atualizada",
    invalidate: [
      ["project", projectId],
      ["repository-access", projectId],
      ["repository-inspection", projectId],
    ],
    onSuccess: () => setToken(""),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (save.isPending || token.trim() === "") {
      return;
    }
    save.mutate(token.trim());
  };
  return { token, setToken, save, submit };
}

/** Saves, replaces or removes the GitHub token used to clone a private repository. */
export function RepositoryTokenSection({
  projectId,
  hasToken,
}: {
  readonly projectId: string;
  readonly hasToken: boolean;
}) {
  const { token, setToken, save, submit } = useRepositoryToken(projectId);
  const access = useQuery({
    queryKey: ["repository-access", projectId],
    queryFn: () => getRepositoryAccessFn({ data: { projectId } }),
    staleTime: 300_000,
    retry: false,
  });
  const accessLabels = {
    "github-app": "Acesso pelo GitHub App",
    token: "Acesso pelo token salvo",
    public: "Repositório público: token dispensado",
  };
  return (
    <SettingsSection
      id="settings-access"
      icon={KeyRoundIcon}
      title="Acesso ao repositório"
      description="O painel usa o GitHub App automaticamente. Um token manual é opcional."
    >
      <div className="space-y-3">
        {access.isPending ? (
          <p role="status" className="text-sm text-muted-foreground">
            Verificando acesso ao GitHub…
          </p>
        ) : null}
        {access.data == null ? null : (
          <Tag icon={CircleCheckIcon} tone="success">
            {accessLabels[access.data.access]}
          </Tag>
        )}
        {access.isError ? (
          <div role="status" className="space-y-2">
            <p className="text-sm text-warning">
              {toUserMessage(
                access.error,
                "Não foi possível verificar o acesso. Confira a instalação do GitHub App ou informe um token.",
              )}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={access.isFetching}
              onClick={() => void access.refetch()}
            >
              Verificar acesso ao repositório
            </Button>
          </div>
        ) : null}
        <details>
          <summary className="w-fit cursor-pointer rounded-md text-sm font-medium text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">
            {hasToken ? "Gerenciar token salvo" : "Usar token manual (opcional)"}
          </summary>
          <form className="space-y-3" onSubmit={submit}>
            <Tag icon={hasToken ? CircleCheckIcon : CircleDashedIcon}>
              {hasToken ? "Token manual salvo" : "Nenhum token manual"}
            </Tag>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-2">
                <Label htmlFor="repository-token">{hasToken ? "Substituir token" : "Token"}</Label>
                <Input
                  id="repository-token"
                  type="password"
                  autoComplete="off"
                  disabled={save.isPending}
                  placeholder="github_pat_…"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                />
              </div>
              <Button type="submit" disabled={save.isPending || token.trim() === ""}>
                <SaveIcon aria-hidden />
                Salvar token do repositório
              </Button>
              {hasToken ? (
                <RemoveTokenButton disabled={save.isPending} onRemove={() => save.mutate(null)} />
              ) : null}
            </div>
          </form>
        </details>
      </div>
    </SettingsSection>
  );
}

function RemoveTokenButton({
  disabled,
  onRemove,
}: {
  readonly disabled: boolean;
  readonly onRemove: () => void;
}) {
  return (
    <ConfirmDialog
      trigger={
        <Button type="button" variant="outline" disabled={disabled}>
          <Trash2Icon aria-hidden />
          Remover token do repositório
        </Button>
      }
      title="Remover o token?"
      description="O painel passará a usar o GitHub App ou acesso público. Confira se uma dessas opções dá acesso ao repositório antes de remover o token."
      confirmLabel="Remover token do repositório"
      destructive
      onConfirm={onRemove}
    />
  );
}
