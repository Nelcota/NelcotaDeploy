import { Link } from "@tanstack/react-router";
import { ChevronLeftIcon, GitBranchIcon, GlobeIcon } from "lucide-react";
import type { ReactNode } from "react";

import { GitHubIcon } from "@/web/components/github/github.icon";
import { ContainerStateBadge } from "@/web/components/layout/status-badge";
import { ProjectActions } from "@/web/components/projects/project-actions";
import type { ProjectDetails } from "@/web/components/projects/project-query";
import { PROJECT_SECTIONS } from "@/web/components/shell/navigation";
import { PageNavigation } from "@/web/components/shell/navigation/page-navigation";

/** The container of the project's current deployment, if the worker has seen it. */
export function currentContainer(details: ProjectDetails) {
  return (
    details.containers.find(
      (container) => container.deploymentId === details.project.currentDeploymentId,
    ) ?? null
  );
}

function publicUrl(details: ProjectDetails): string | null {
  const [domain] = details.domains;
  if (domain == null) {
    return null;
  }
  return `${domain.httpsEnabled ? "https" : "http"}://${domain.hostname}`;
}

const HEADER_LINK =
  "max-w-full min-w-0 truncate rounded-sm font-mono transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

function ProjectLinks({
  url,
  project,
}: {
  readonly url: string | null;
  readonly project: ProjectDetails["project"];
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
      {url == null ? null : (
        <a
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          title={url}
          className={`${HEADER_LINK} inline-flex items-center gap-1.5`}
        >
          <GlobeIcon aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">{url.replace(/^https?:\/\//, "")}</span>
          <span className="sr-only"> (abre em nova aba)</span>
        </a>
      )}
      <a
        href={`https://github.com/${project.repositoryFullName}`}
        target="_blank"
        rel="noreferrer noopener"
        title={project.repositoryFullName}
        className={`${HEADER_LINK} inline-flex items-center gap-1.5`}
      >
        <GitHubIcon aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate">{project.repositoryFullName}</span>
        <span className="sr-only"> (repositório no GitHub, abre em nova aba)</span>
      </a>
      <span className="inline-flex min-w-0 max-w-full items-start gap-1.5 font-mono">
        <GitBranchIcon aria-hidden className="mt-1 size-3.5 shrink-0" />
        <span className="[overflow-wrap:anywhere]">{project.branch}</span>
      </span>
    </div>
  );
}

/**
 * Header shared by every project page: where you are, the project's state, its address,
 * the actions, and the grouped navigation to each project page.
 */
export function ProjectBand({ details }: { readonly details: ProjectDetails }) {
  const { project } = details;
  const container = currentContainer(details);
  const url = publicUrl(details);
  return (
    <div className="space-y-5">
      <Link
        to="/projects"
        className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <ChevronLeftIcon aria-hidden className="size-4" />
        Todos os projetos
      </Link>
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h1 className="max-w-full min-w-0 text-2xl leading-tight font-semibold tracking-tight [overflow-wrap:anywhere]">
              {project.name}
            </h1>
            <ContainerStateBadge
              state={container?.state ?? null}
              health={container?.health ?? null}
            />
          </div>
          <ProjectLinks url={url} project={project} />
        </div>
        <ProjectActions details={details} containerState={container?.state ?? null} url={url} />
      </header>
      <ProjectTabs projectId={project.id} />
    </div>
  );
}

function ProjectTabs({ projectId }: { readonly projectId: string }) {
  const items = PROJECT_SECTIONS.map((section) => ({
    href: section.to.replace("$projectId", encodeURIComponent(projectId)),
    to: section.to,
    params: { projectId },
    label: section.label,
    group: section.group,
    exact: section.exact,
    link: (
      <Link
        to={section.to}
        params={{ projectId }}
        activeOptions={{ exact: section.exact }}
        preload={false}
      >
        <section.icon aria-hidden />
        {section.label}
      </Link>
    ),
  }));
  return <PageNavigation label="Páginas do projeto" items={items} />;
}

/**
 * Title row of a project tab: a heading with an optional count, one line of description and
 * the actions on the right. No icon here: the selected tab right above already shows it.
 */
export function TabHeader({
  title,
  count,
  description,
  actions,
}: {
  readonly title: ReactNode;
  /** Number of items listed in the tab; omitted while loading. */
  readonly count?: number | null;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="min-w-0 space-y-0.5">
          <h2 className="flex min-w-0 flex-wrap items-center gap-2.5 text-xl leading-tight font-semibold tracking-tight break-words">
            {title}
            {count == null ? null : (
              <span className="rounded-md bg-well px-1.5 py-0.5 text-xs font-medium text-muted-foreground tabular-nums">
                {count}
              </span>
            )}
          </h2>
          {description == null ? null : (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      </div>
      {actions == null ? null : (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
