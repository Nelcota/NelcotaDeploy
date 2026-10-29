import { Link, useRouterState } from "@tanstack/react-router";
import { FolderGit2Icon, GitBranchIcon, GlobeIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";

import { ContainerStateBadge } from "@/web/components/layout/status-badge";
import { ProjectActions } from "@/web/components/projects/project-actions";
import type { ProjectDetails } from "@/web/components/projects/project-query";
import { PROJECT_SECTIONS } from "@/web/components/shell/navigation";

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
        <FolderGit2Icon aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate">{project.repositoryFullName}</span>
        <span className="sr-only"> (repositório no GitHub, abre em nova aba)</span>
      </a>
      <span className="inline-flex items-center gap-1.5 font-mono">
        <GitBranchIcon aria-hidden className="size-3.5" />
        {project.branch}
      </span>
    </div>
  );
}

/**
 * Header shared by every project page: where you are, the project's state, its address,
 * the actions, and the tabs that lead to each part of the project.
 */
export function ProjectBand({ details }: { readonly details: ProjectDetails }) {
  const { project } = details;
  const container = currentContainer(details);
  const url = publicUrl(details);
  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h1 className="max-w-full min-w-0 truncate text-2xl leading-tight font-semibold tracking-tight">
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
  const navRef = useRef<HTMLElement>(null);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  // On narrow screens the tabs scroll sideways; keep the open one in view.
  useEffect(() => {
    navRef.current
      ?.querySelector("[data-status=active]")
      ?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [pathname]);
  return (
    <nav
      ref={navRef}
      aria-label="Seções do projeto"
      className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none] max-sm:[mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)]"
    >
      <ul className="flex w-fit min-w-max gap-2 py-0.5">
        {PROJECT_SECTIONS.map((section) => (
          <li key={section.to}>
            <Link
              to={section.to}
              params={{ projectId }}
              activeOptions={{ exact: section.exact }}
              className="inline-flex h-9 items-center gap-2 rounded-full bg-well px-4 text-sm text-foreground ring-1 ring-border transition-colors hover:bg-well-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[status=active]:bg-primary data-[status=active]:text-primary-foreground data-[status=active]:ring-primary"
            >
              <section.icon aria-hidden className="size-4" />
              {section.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
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
          <h2 className="flex items-center gap-2.5 text-xl leading-tight font-semibold tracking-tight">
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
