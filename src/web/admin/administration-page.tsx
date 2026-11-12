import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { Permission } from "@/shared/roles";
import { PageHeader } from "@/web/components/shell/page-header";
import { useCan } from "@/web/components/shell/use-permissions";

import { AdministrationNavigation } from "./navigation/administration-navigation";

/** Gates restricted pages before their content mounts or requests data. */
export function AdministrationPage({
  title,
  permission,
  children,
}: {
  readonly title: string;
  readonly permission?: Permission;
  readonly children: ReactNode;
}) {
  const can = useCan();
  return (
    <div className="space-y-4">
      <Link
        to="/settings"
        search={{}}
        className="inline-flex min-h-8 items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span aria-hidden className="solar-[alt-arrow-left-linear] size-4" />
        Administração
      </Link>
      <div className="grid gap-6 xl:grid-cols-[14rem_minmax(0,1fr)]">
        <div className="hidden xl:block">
          <AdministrationNavigation />
        </div>
        <div className="min-w-0 space-y-6">
          <PageHeader title={title} />
          {permission != null && can(permission) === false ? (
            <p role="alert">Você não tem permissão para acessar esta página.</p>
          ) : (
            children
          )}
        </div>
      </div>
    </div>
  );
}
