import { useQuery } from "@tanstack/react-query";
import { UsersIcon } from "lucide-react";

import { EmptyState, ErrorState, ListSkeleton } from "@/web/components/layout/states";
import { listUsersFn } from "@/web/functions/settings.functions";

import type { UserView } from "./user-row";
import { UserRows } from "./user-rows";

/** Every account, with the loading, error and empty states of the list. */
export function UserList() {
  const users = useQuery({ queryKey: ["users"], queryFn: () => listUsersFn() });
  return (
    <>
      {users.isError ? (
        <ErrorState error={users.error} onRetry={() => void users.refetch()} />
      ) : null}
      <UserListBody users={users.data} isError={users.isError} />
    </>
  );
}

function UserListBody({
  users,
  isError,
}: {
  readonly users: readonly UserView[] | undefined;
  readonly isError: boolean;
}) {
  if (users == null) {
    return isError ? null : <ListSkeleton />;
  }
  if (users.length === 0) {
    return <EmptyState icon={UsersIcon} title="Nenhum usuário" />;
  }
  return <UserRows users={users} />;
}
