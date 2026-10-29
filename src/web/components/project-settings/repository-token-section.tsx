import {
  CircleCheckIcon,
  CircleDashedIcon,
  KeyRoundIcon,
  SaveIcon,
  Trash2Icon,
} from "lucide-react";
import { type FormEvent, useState } from "react";

import { ConfirmDialog } from "@/web/components/layout/confirm-dialog";
import { Tag } from "@/web/components/layout/layout";
import { useAction } from "@/web/components/layout/use-action";
import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";
import { setRepositoryTokenFn } from "@/web/functions/projects.functions";

import { SettingsSection } from "./settings-section";

function useRepositoryToken(projectId: string) {
  const [token, setToken] = useState("");
  const save = useAction({
    action: (value: string | null) => setRepositoryTokenFn({ data: { projectId, token: value } }),
    successMessage: (_result) => "Credencial atualizada",
    invalidate: [["project", projectId]],
    onSuccess: () => setToken(""),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (token.trim() === "") {
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
  return (
    <SettingsSection
      icon={KeyRoundIcon}
      title="Repositório privado"
      description="Token de leitura do GitHub (permissão “Contents: read”). Fica criptografado e nunca é exibido."
    >
      <form className="space-y-3" onSubmit={submit}>
        <Tag icon={hasToken ? CircleCheckIcon : CircleDashedIcon}>
          {hasToken ? "Token salvo" : "Sem token"}
        </Tag>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-2">
            <Label htmlFor="repository-token">{hasToken ? "Substituir token" : "Token"}</Label>
            <Input
              id="repository-token"
              type="password"
              autoComplete="off"
              placeholder="github_pat_…"
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          </div>
          <Button type="submit" disabled={save.isPending || token.trim() === ""}>
            <SaveIcon aria-hidden />
            Salvar token
          </Button>
          {hasToken ? (
            <RemoveTokenButton disabled={save.isPending} onRemove={() => save.mutate(null)} />
          ) : null}
        </div>
      </form>
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
          Remover
        </Button>
      }
      title="Remover o token?"
      description="Deploys de repositórios privados vão falhar até um novo token ser salvo."
      confirmLabel="Remover"
      destructive
      onConfirm={onRemove}
    />
  );
}
