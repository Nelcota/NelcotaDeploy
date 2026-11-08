import type { ReactNode } from "react";

import type { Permission } from "@/shared/roles";
import { PageHeader } from "@/web/components/shell/page-header";
import { useCan } from "@/web/components/shell/use-permissions";

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
    <>
      <PageHeader title={title} />
      {permission != null && can(permission) === false ? (
        <p role="alert">Você não tem permissão para acessar esta página.</p>
      ) : (
        children
      )}
    </>
  );
}
