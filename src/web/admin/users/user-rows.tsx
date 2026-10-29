import { useRouteContext } from "@tanstack/react-router";
import { useState } from "react";

import type { Role } from "@/shared/roles";
import { ConfirmDialog } from "@/web/components/layout/confirm-dialog";
import { List } from "@/web/components/layout/layout";
import { useAction } from "@/web/components/layout/use-action";
import { setUserDisabledFn, updateUserRoleFn } from "@/web/functions/settings.functions";

import { ResetPasswordDialog } from "./reset-password-dialog";
import { UserRow, type UserView } from "./user-row";

type UserReference = { readonly id: string; readonly name: string };

function useUserMutations() {
  const updateRole = useAction({
    action: (input: { readonly userId: string; readonly role: Role }) =>
      updateUserRoleFn({ data: input }),
    successMessage: "Papel atualizado",
    invalidate: [["users"]],
  });
  const setDisabled = useAction({
    action: (input: { readonly userId: string; readonly disabled: boolean }) =>
      setUserDisabledFn({ data: input }),
    successMessage: (_result) => "Usuário atualizado",
    invalidate: [["users"]],
  });
  return { updateRole, setDisabled };
}

function DisableUserDialog({
  user,
  onCancel,
  onConfirm,
}: {
  readonly user: UserReference | null;
  readonly onCancel: () => void;
  readonly onConfirm: (user: UserReference) => void;
}) {
  return (
    <ConfirmDialog
      open={user != null}
      onOpenChange={(open) => {
        if (open === false) {
          onCancel();
        }
      }}
      title={`Desativar ${user?.name ?? "usuário"}?`}
      description="A pessoa perde o acesso e as sessões abertas são encerradas. Dá para reativar depois."
      confirmLabel="Desativar"
      destructive
      onConfirm={() => {
        if (user != null) {
          onConfirm(user);
        }
      }}
    />
  );
}

/** Rows of the users list, with the dialogs their actions open. */
export function UserRows({ users }: { readonly users: readonly UserView[] }) {
  const { user: currentUser } = useRouteContext({ from: "/_app" });
  const [resetUser, setResetUser] = useState<UserReference | null>(null);
  const [disablingUser, setDisablingUser] = useState<UserReference | null>(null);
  const { updateRole, setDisabled } = useUserMutations();
  return (
    <>
      <List>
        {users.map((user) => (
          <UserRow
            key={user.id}
            user={user}
            isCurrentUser={user.id === currentUser.id}
            onRoleChange={(role) => updateRole.mutate({ userId: user.id, role })}
            onActiveChange={(active) => {
              if (active) {
                setDisabled.mutate({ userId: user.id, disabled: false });
                return;
              }
              setDisablingUser({ id: user.id, name: user.name });
            }}
            onResetPassword={() => setResetUser({ id: user.id, name: user.name })}
          />
        ))}
      </List>
      <DisableUserDialog
        user={disablingUser}
        onCancel={() => setDisablingUser(null)}
        onConfirm={(user) => setDisabled.mutate({ userId: user.id, disabled: true })}
      />
      {resetUser == null ? null : (
        <ResetPasswordDialog
          key={resetUser.id}
          user={resetUser}
          onClose={() => setResetUser(null)}
        />
      )}
    </>
  );
}
