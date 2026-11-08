import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ExternalLinkIcon, GitPullRequestIcon } from "lucide-react";

import { CardTitleRow, TEXT_LINK } from "@/web/components/layout/layout";
import { ErrorState, ListSkeleton } from "@/web/components/layout/states";
import { DeploymentStatusBadge } from "@/web/components/layout/status-badge";
import { TabHeader } from "@/web/components/projects/project-header";
import { projectQueryOptions } from "@/web/components/projects/project-query";
import { Card } from "@/web/components/ui/card";
import { Skeleton } from "@/web/components/ui/skeleton";
import { listPreviewsFn } from "@/web/functions/previews/previews.functions";

// A preview's state changes with each push to its pull request.
const PREVIEWS_REFRESH_IN_MS = 15_000;

type Preview = Awaited<ReturnType<typeof listPreviewsFn>>["previews"][number];

/**
 * The project's open pull request previews, each with its state, address and deployment.
 * Disabled projects keep their explicit state visible on the dedicated previews page.
 */
function PreviewsCard({
  projectId,
  branch,
  enabled,
}: {
  readonly projectId: string;
  readonly branch: string;
  readonly enabled: boolean;
}) {
  const previews = useQuery({
    queryKey: ["previews", projectId],
    queryFn: () => listPreviewsFn({ data: { projectId } }),
    refetchInterval: PREVIEWS_REFRESH_IN_MS,
  });
  if (previews.isError) {
    return <ErrorState error={previews.error} onRetry={() => void previews.refetch()} />;
  }
  return (
    <Card className="gap-4 p-5">
      <CardTitleRow icon={GitPullRequestIcon} title="Ambientes de teste" />
      {enabled ? null : (
        <p role="status" className="text-sm text-muted-foreground">
          Ambientes de teste estão desativados para novos pull requests.{" "}
          <Link
            to="/projects/$projectId/settings/automation"
            params={{ projectId }}
            className={TEXT_LINK}
          >
            Configurar automação de deploys
          </Link>
        </p>
      )}
      <PreviewList
        projectId={projectId}
        branch={branch}
        previews={previews.data?.previews ?? null}
        limit={previews.data?.limit ?? null}
      />
    </Card>
  );
}

/** Lists pull request environments independently from the production application. */
export function ProjectPreviewsPage({ projectId }: { readonly projectId: string }) {
  const project = useQuery(projectQueryOptions(projectId));
  if (project.isError) {
    return <ErrorState error={project.error} onRetry={() => void project.refetch()} />;
  }
  if (project.data == null) {
    return <ListSkeleton rows={2} />;
  }
  return (
    <>
      <TabHeader title="Ambientes de teste por pull request" />
      <PreviewsCard
        projectId={projectId}
        branch={project.data.project.branch}
        enabled={project.data.project.previewsEnabled}
      />
    </>
  );
}

function PreviewList({
  projectId,
  branch,
  previews,
  limit,
}: {
  readonly projectId: string;
  readonly branch: string;
  readonly previews: readonly Preview[] | null;
  readonly limit: number | null;
}) {
  if (previews == null) {
    return <Skeleton className="h-16 rounded-lg" />;
  }
  if (previews.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhum pull request aberto para {branch}. Cada um ganha um endereço próprio enquanto estiver
        aberto, até {limit} ao mesmo tempo.
      </p>
    );
  }
  return (
    <ul className="-mx-2 divide-y divide-border">
      {previews.map((preview) => (
        <PreviewRow key={preview.id} projectId={projectId} preview={preview} />
      ))}
    </ul>
  );
}

function PreviewRow({
  projectId,
  preview,
}: {
  readonly projectId: string;
  readonly preview: Preview;
}) {
  return (
    <li className="flex flex-col gap-2 px-2 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium">PR #{preview.pullRequestNumber}</p>
        <p className="truncate font-mono text-xs text-muted-foreground">{preview.branch}</p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {preview.latestDeployment == null ? null : (
          <Link
            to="/projects/$projectId/deployments/$deploymentId"
            params={{ projectId, deploymentId: preview.latestDeployment.id }}
            aria-label={`Deploy do PR #${preview.pullRequestNumber}`}
          >
            <DeploymentStatusBadge status={preview.latestDeployment.status} />
          </Link>
        )}
        {preview.url == null ? null : (
          <a href={preview.url} target="_blank" rel="noreferrer" className={TEXT_LINK}>
            <ExternalLinkIcon aria-hidden className="mr-1 inline size-3.5" />
            Abrir
          </a>
        )}
      </div>
    </li>
  );
}
