import { useState } from "react";

import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";

function connectUrl(organization: string): string {
  const trimmed = organization.trim();
  if (trimmed === "") {
    return "/api/github/app/new";
  }
  return `/api/github/app/new?organization=${encodeURIComponent(trimmed)}`;
}

/** Starts the creation of the GitHub App, under the user's account or an organization. */
export function ConnectGitHubApp({ canEdit }: { readonly canEdit: boolean }) {
  const [organization, setOrganization] = useState("");
  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-sm text-muted-foreground">
        Crie um app no GitHub para escolher repositórios da lista, clonar repositórios privados sem
        token e fazer deploy a cada push sem configurar webhook.
      </p>
      {canEdit ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="space-y-2 sm:w-64">
            <Label htmlFor="github-organization">Organização (opcional)</Label>
            <Input
              id="github-organization"
              placeholder="Sua conta pessoal"
              value={organization}
              onChange={(event) => setOrganization(event.target.value)}
            />
          </div>
          <Button asChild>
            <a href={connectUrl(organization)}>Conectar ao GitHub</a>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
