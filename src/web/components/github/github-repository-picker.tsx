import { useQuery } from "@tanstack/react-query";
import { LockIcon } from "lucide-react";

import type { ProjectFormApi } from "@/web/components/forms/project-form";
import { fillIdentityFromRepository } from "@/web/components/forms/project-form-fields";
import { Label } from "@/web/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";
import { listGitHubRepositoriesFn } from "@/web/functions/projects.functions";

const REPOSITORIES_STALE_TIME_IN_MS = 300_000; // 5 minutes

/**
 * Lets a new project start from a repository the GitHub App can read, filling the URL, the
 * branch and the name. Renders nothing without a connected app.
 */
export function GitHubRepositoryPicker({ form }: { readonly form: ProjectFormApi }) {
  const repositories = useQuery({
    queryKey: ["github-repositories"],
    queryFn: () => listGitHubRepositoriesFn(),
    staleTime: REPOSITORIES_STALE_TIME_IN_MS,
    retry: false,
  });
  const list = repositories.data ?? [];
  if (list.length === 0) {
    return null;
  }
  const byName = new Map(list.map((repository) => [repository.fullName, repository]));

  const choose = (fullName: string) => {
    const repository = byName.get(fullName);
    if (repository == null) {
      return;
    }
    const url = `https://github.com/${repository.fullName}`;
    form.setFieldValue("repositoryUrl", url);
    form.setFieldValue("branch", repository.defaultBranch);
    fillIdentityFromRepository(form, url);
  };

  return (
    <div className="space-y-2 sm:col-span-2">
      <Label htmlFor="github-repository">Repositório do GitHub</Label>
      <Select onValueChange={choose}>
        <SelectTrigger id="github-repository" className="w-full">
          <SelectValue placeholder="Escolher da lista ou colar a URL abaixo" />
        </SelectTrigger>
        <SelectContent>
          {list.map((repository) => (
            <SelectItem key={repository.fullName} value={repository.fullName}>
              {repository.fullName}
              {repository.isPrivate ? (
                <LockIcon aria-label="Privado" className="text-muted-foreground" />
              ) : null}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
