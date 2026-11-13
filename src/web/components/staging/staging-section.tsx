import { Link } from "@tanstack/react-router";
import { FlaskConicalIcon, PlusIcon } from "lucide-react";
import { type FormEvent, useState } from "react";

import { stagingInputSchema } from "@/shared/schemas/staging.schema";
import { SettingsSection } from "@/web/components/project-settings/settings-section";
import { Button } from "@/web/components/ui/button";
import { Checkbox } from "@/web/components/ui/checkbox";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";

import { useCreateStaging } from "./use-staging";

const ERROR_ID = "staging-branch-error";

/** Settings card of a production project: opens its staging, or creates one. */
export function StagingSection({
  projectId,
  stagingId,
  canEdit,
}: {
  readonly projectId: string;
  readonly stagingId: string | null;
  readonly canEdit: boolean;
}) {
  return (
    <SettingsSection
      icon={FlaskConicalIcon}
      title="Teste antes de publicar"
      description="Uma cópia do projeto que faz deploy de outra branch, com domínio, variáveis e bancos próprios. O que estiver bom no staging pode ser promovido para a produção."
    >
      {stagingId == null ? null : (
        <Button variant="outline" asChild>
          <Link to="/projects/$projectId" params={{ projectId: stagingId }}>
            Abrir o staging
          </Link>
        </Button>
      )}
      {stagingId == null && canEdit ? <CreateStagingForm projectId={projectId} /> : null}
      {stagingId == null && canEdit === false ? (
        <p className="text-sm text-muted-foreground">Este projeto ainda não tem staging.</p>
      ) : null}
    </SettingsSection>
  );
}

function CreateStagingForm({ projectId }: { readonly projectId: string }) {
  const create = useCreateStaging(projectId);
  const [branch, setBranch] = useState("staging");
  const [copyVariables, setCopyVariables] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = stagingInputSchema.safeParse({ branch, copyVariables });
    if (parsed.success === false) {
      setError(parsed.error.issues[0]?.message ?? "Nome de branch inválido");
      return;
    }
    setError(null);
    create.mutate(parsed.data);
  };
  return (
    <form className="max-w-md space-y-4" onSubmit={submit} noValidate>
      <div className="space-y-2">
        <Label htmlFor="staging-branch">Branch do staging</Label>
        <Input
          id="staging-branch"
          className="font-mono"
          aria-invalid={error != null}
          aria-describedby={error == null ? undefined : ERROR_ID}
          value={branch}
          onChange={(event) => setBranch(event.target.value)}
        />
        <p id={ERROR_ID} aria-live="polite" className="text-sm text-destructive empty:hidden">
          {error ?? ""}
        </p>
      </div>
      <div className="flex items-start gap-3">
        <Checkbox
          id="staging-copy-variables"
          checked={copyVariables}
          onCheckedChange={(checked) => setCopyVariables(checked === true)}
          aria-describedby="staging-copy-variables-hint"
        />
        <div className="space-y-1">
          <Label htmlFor="staging-copy-variables">Copiar as variáveis da produção</Label>
          <p id="staging-copy-variables-hint" className="text-xs text-muted-foreground">
            As URLs dos bancos de dados da produção nunca são copiadas: crie bancos próprios no
            staging.
          </p>
        </div>
      </div>
      <Button type="submit" disabled={create.isPending || branch.trim() === ""}>
        <PlusIcon aria-hidden />
        Criar staging
      </Button>
    </form>
  );
}
