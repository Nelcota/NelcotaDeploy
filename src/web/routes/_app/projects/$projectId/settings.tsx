import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet, useChildMatches, useLocation } from "@tanstack/react-router";
import { type Ref, useEffect, useRef } from "react";

import {
  type ProjectSettingsDestination,
  SETTINGS_HEADING_ID,
  visibleSettingsSections,
} from "@/web/components/project-settings/navigation/settings-destinations";
import { ProjectSettingsNavigation } from "@/web/components/project-settings/project-settings-navigation";
import { projectQueryOptions } from "@/web/components/projects/project-query";
import { useCan } from "@/web/components/shell/use-permissions";

export const Route = createFileRoute("/_app/projects/$projectId/settings")({
  head: () => ({ meta: [{ title: "Configurações do projeto · Nelcota Deploy" }] }),
  component: ProjectSettingsLayout,
});

function SettingsHeading({
  current,
  overview,
  headingRef,
}: {
  readonly current: ProjectSettingsDestination | undefined;
  readonly overview: boolean;
  readonly headingRef: Ref<HTMLHeadingElement>;
}) {
  const title = current?.label ?? (overview ? "Configurações do projeto" : "Acesso restrito");
  const description =
    current?.description ?? (overview ? "Escolha o que você quer ajustar neste projeto." : null);
  return (
    <header id={SETTINGS_HEADING_ID} className="scroll-mt-4 space-y-1">
      {current == null ? null : (
        <p className="text-sm text-muted-foreground">Configurações do projeto</p>
      )}
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="rounded-sm text-xl font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
      >
        {title}
      </h2>
      {description == null ? null : (
        <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
      )}
    </header>
  );
}

function ProjectSettingsLayout() {
  const { projectId } = Route.useParams();
  const { data } = useQuery(projectQueryOptions(projectId));
  const can = useCan();
  const path = useChildMatches({ select: (matches) => matches.at(-1)?.fullPath });
  const hash = useLocation({ select: (location) => location.hash });
  const heading = useRef<HTMLHeadingElement>(null);
  const destinations = visibleSettingsSections(can);
  const current = destinations.find((destination) => destination.to === path);
  const overview = path === "/projects/$projectId/settings/";

  useEffect(() => {
    if (hash === SETTINGS_HEADING_ID) {
      heading.current?.focus({ preventScroll: true });
    }
  }, [data?.project.id, hash, path]);

  if (data == null) {
    return null;
  }

  return (
    <div className="@container/settings space-y-4">
      <SettingsHeading headingRef={heading} current={current} overview={overview} />
      <div className="grid gap-4 @min-[52rem]/settings:grid-cols-[14rem_minmax(0,1fr)] @min-[52rem]/settings:gap-6">
        <ProjectSettingsNavigation
          key={path}
          projectId={projectId}
          destinations={destinations}
          current={current}
          overview={overview}
        />
        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
