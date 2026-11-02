import { UserMinusIcon } from "lucide-react";

import type { ProjectRole } from "@/shared/roles";
import { UserAvatar } from "@/web/components/account/user-avatar";
import { ConfirmDialog } from "@/web/components/layout/confirm-dialog";
import { Button } from "@/web/components/ui/button";

import { ProjectRoleSelect } from "./project-role-select";

type Member = {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly image: string | null;
  readonly role: ProjectRole;
};

/** One member of the project: who they are, their role and how to remove them. */
export function MemberRow({
  member,
  busy,
  onRoleChange,
  onRemove,
}: {
  readonly member: Member;
  readonly busy: boolean;
  readonly onRoleChange: (role: ProjectRole) => void;
  readonly onRemove: () => void;
}) {
  return (
    <li className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <UserAvatar name={member.name} image={member.image} className="size-8" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{member.name}</p>
          <p className="truncate text-xs text-muted-foreground">{member.email}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <ProjectRoleSelect
          label={`Papel de ${member.name} no projeto`}
          value={member.role}
          disabled={busy}
          onChange={onRoleChange}
        />
        <ConfirmDialog
          trigger={
            <Button variant="ghost" size="sm" disabled={busy}>
              <UserMinusIcon aria-hidden />
              Remover
            </Button>
          }
          title={`Remover ${member.name} do projeto?`}
          description="A pessoa deixa de ver este projeto e o staging dele. Você pode adicioná-la de novo depois."
          confirmLabel="Remover"
          destructive
          onConfirm={onRemove}
        />
      </div>
    </li>
  );
}
