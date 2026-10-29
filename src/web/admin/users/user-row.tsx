import { KeyRoundIcon, ShieldCheckIcon } from "lucide-react";

import { formatDate } from "@/shared/format";
import type { Role } from "@/shared/roles";
import { UserAvatar } from "@/web/components/account/user-avatar";
import { ROLE_LABELS } from "@/web/components/layout/labels";
import { ListRow, Tag } from "@/web/components/layout/layout";
import { StatusPill } from "@/web/components/layout/status-badge";
import { Button } from "@/web/components/ui/button";
import type { listUsersFn } from "@/web/functions/admin/users.functions";

import { UserAccessControls } from "./user-access-controls";

export type UserView = Awaited<ReturnType<typeof listUsersFn>>[number];

function UserIdentity({
  user,
  isCurrentUser,
}: {
  readonly user: UserView;
  readonly isCurrentUser: boolean;
}) {
  return (
    // On phones the person fills the first line and the controls wrap below.
    <div className="min-w-0 flex-1 basis-[calc(100%-3.25rem)] space-y-0.5 md:basis-auto">
      <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
        <span className="truncate">{user.name}</span>
        {isCurrentUser ? (
          <span className="shrink-0 font-normal text-muted-foreground">(você)</span>
        ) : null}
        {user.disabled ? <StatusPill tone="neutral" label="Desativado" /> : null}
      </p>
      <p className="truncate text-sm text-muted-foreground" title={user.email}>
        {user.email}
      </p>
      <p className="text-xs text-muted-foreground">Criado em {formatDate(user.createdAt)}</p>
    </div>
  );
}

/** One account in the users list, with its controls. */
export function UserRow({
  user,
  isCurrentUser,
  onRoleChange,
  onActiveChange,
  onResetPassword,
}: {
  readonly user: UserView;
  readonly isCurrentUser: boolean;
  readonly onRoleChange: (role: Role) => void;
  readonly onActiveChange: (active: boolean) => void;
  readonly onResetPassword: () => void;
}) {
  return (
    <ListRow className="flex-wrap md:flex-nowrap">
      <UserAvatar name={user.name} image={user.image} />
      <UserIdentity user={user} isCurrentUser={isCurrentUser} />
      <div className="flex w-full flex-wrap items-center gap-3 pl-13 md:w-auto md:flex-nowrap md:pl-0">
        {isCurrentUser ? (
          // Your own role and access cannot change here, so show them instead of
          // controls that would only ever be disabled.
          <Tag icon={ShieldCheckIcon}>{ROLE_LABELS[user.role]}</Tag>
        ) : (
          <UserAccessControls
            user={user}
            onRoleChange={onRoleChange}
            onActiveChange={onActiveChange}
          />
        )}
        <Button variant="ghost" size="sm" onClick={onResetPassword}>
          <KeyRoundIcon aria-hidden />
          Redefinir senha
        </Button>
      </div>
    </ListRow>
  );
}
