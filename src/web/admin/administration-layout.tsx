import { Outlet, useChildMatches } from "@tanstack/react-router";
import { type Ref, useEffect, useRef } from "react";

import {
  type AdministrationSection,
  visibleAdministrationSections,
} from "@/web/components/shell/navigation/administration-destinations";
import { useCan } from "@/web/components/shell/use-permissions";

import { AdministrationNavigation } from "./navigation/administration-navigation";

function AdministrationHeading({
  current,
  overview,
  headingRef,
}: {
  readonly current: AdministrationSection | undefined;
  readonly overview: boolean;
  readonly headingRef: Ref<HTMLHeadingElement>;
}) {
  const title = current?.label ?? (overview ? "Administração" : "Acesso restrito");
  const description =
    current?.description ?? (overview ? "Escolha o que você quer ajustar no painel." : null);
  return (
    <header className="space-y-1">
      {overview ? null : <p className="text-sm text-muted-foreground">Administração</p>}
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="rounded-sm text-2xl font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
      >
        {title}
      </h1>
      {description == null ? null : (
        <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
      )}
    </header>
  );
}

/** Renders the administration navigation and gates restricted sections before they mount. */
export function AdministrationLayout() {
  const can = useCan();
  const path = useChildMatches({ select: (matches) => matches.at(-1)?.fullPath });
  const previousPath = useRef(path);
  const heading = useRef<HTMLHeadingElement>(null);
  const sections = visibleAdministrationSections(can);
  const overview = path === "/settings/";
  const current = sections.find((section) => section.to === path);

  useEffect(() => {
    if (previousPath.current !== path) {
      previousPath.current = path;
      heading.current?.focus({ preventScroll: true });
    }
  }, [path]);

  return (
    <div className="@container/settings space-y-4">
      <AdministrationHeading current={current} overview={overview} headingRef={heading} />
      <div className="grid gap-4 @min-[52rem]/settings:grid-cols-[14rem_minmax(0,1fr)] @min-[52rem]/settings:gap-6">
        <AdministrationNavigation
          key={path}
          sections={sections}
          current={current}
          overview={overview}
        />
        <div className="min-w-0">
          {overview || current != null ? (
            <Outlet />
          ) : (
            <p
              role="alert"
              className="rounded-xl border border-border bg-surface-raised p-4 text-sm"
            >
              Você não tem permissão para acessar esta seção. Use o menu para abrir uma seção
              disponível.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
