import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { LockIcon } from "lucide-react";
import { useState } from "react";

import type { ProjectFormApi } from "@/web/components/forms/project-form";
import { toUserMessage } from "@/web/components/layout/error-message";
import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";
import { listGitHubRepositoriesFn } from "@/web/functions/projects.functions";

const REPOSITORIES_STALE_TIME_IN_MS = 300_000;
const MAX_VISIBLE_REPOSITORIES = 100;

/** Searchable repository selection with explicit connection, loading and retry states. */
export function GitHubRepositoryPicker({ form }: { readonly form: ProjectFormApi }) {
  const [search, setSearch] = useState("");
  const repositories = useQuery({
    queryKey: ["github-repositories"],
    queryFn: () => listGitHubRepositoriesFn(),
    staleTime: REPOSITORIES_STALE_TIME_IN_MS,
  });
  if (repositories.isPending) {
    return (
      <p role="status" className="text-sm text-muted-foreground sm:col-span-2">
        Carregando repositórios do GitHub…
      </p>
    );
  }
  if (repositories.isError) {
    return (
      <div role="status" className="space-y-2 sm:col-span-2">
        <p className="text-sm text-warning">
          {toUserMessage(repositories.error, "Não foi possível carregar os repositórios.")}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void repositories.refetch()}
        >
          Buscar repositórios novamente
        </Button>
      </div>
    );
  }
  if (repositories.data == null) {
    return (
      <p className="text-sm text-muted-foreground sm:col-span-2">
        GitHub App não conectado. Abra{" "}
        <Link
          to="/settings/integrations/github"
          className="font-medium text-brand underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
        >
          Conexão com o GitHub
        </Link>{" "}
        ou cole abaixo a URL de um repositório público.
      </p>
    );
  }
  const list = repositories.data;
  if (list.length === 0) {
    return (
      <div className="space-y-2 sm:col-span-2">
        <p className="text-sm text-warning">
          Nenhum repositório disponível. Confira os repositórios autorizados na instalação do GitHub
          App.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void repositories.refetch()}
        >
          Atualizar repositórios
        </Button>
      </div>
    );
  }
  const matches = list.filter((repository) =>
    repository.fullName.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <div className="space-y-2 sm:col-span-2">
      <Label htmlFor="github-repository-search">Buscar repositório do GitHub</Label>
      <Input
        id="github-repository-search"
        placeholder="Organização ou nome do repositório"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <Select
        onValueChange={(fullName) =>
          form.setFieldValue("repositoryUrl", `https://github.com/${fullName}`)
        }
      >
        <SelectTrigger aria-label="Repositório do GitHub" className="w-full">
          <SelectValue placeholder="Escolher da lista" />
        </SelectTrigger>
        <SelectContent>
          {matches.slice(0, MAX_VISIBLE_REPOSITORIES).map((repository) => (
            <SelectItem key={repository.fullName} value={repository.fullName}>
              {repository.fullName}
              {repository.isPrivate ? (
                <LockIcon aria-label="Privado" className="text-muted-foreground" />
              ) : null}
            </SelectItem>
          ))}
          {matches.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              Nenhum repositório encontrado.
            </p>
          ) : null}
        </SelectContent>
      </Select>
      {matches.length > MAX_VISIBLE_REPOSITORIES ? (
        <p className="text-xs text-faint">
          Mostrando os primeiros {MAX_VISIBLE_REPOSITORIES}. Refine a busca para encontrar outro
          repositório.
        </p>
      ) : null}
    </div>
  );
}
