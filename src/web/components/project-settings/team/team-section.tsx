import { UserPlusIcon, UsersIcon } from "lucide-react";
import { type FormEvent, useState } from "react";

import type { ProjectRole } from "@/shared/roles";
import { Button } from "@/web/components/ui/button";
import { Label } from "@/web/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";

import { SettingsSection } from "../settings-section";
import { MemberRow } from "./member-row";
import { ProjectRoleSelect } from "./project-role-select";
import { useProjectMembers } from "./use-project-members";

type Candidate = { readonly id: string; readonly name: string; readonly email: string };

/** Who besides the admins may open the project, and with which role. */
export function TeamSection({ projectId }: { readonly projectId: string }) {
  const { members, add, changeRole, remove } = useProjectMembers(projectId);
  const list = members.data?.members ?? [];
  const candidates = members.data?.candidates ?? [];
  const busy = add.isPending || changeRole.isPending || remove.isPending;
  return (
    <SettingsSection
      icon={UsersIcon}
      title="Equipe"
      description="Administradores veem todos os projetos. As demais pessoas só veem este projeto, e o staging dele, se forem membros."
    >
      <p className="mb-4 text-sm text-muted-foreground">
        Desenvolvedor faz deploy, rollback e altera variáveis, domínios e tasks. Leitor só
        visualiza.
      </p>
      <div className="space-y-4">
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum membro. Só os administradores veem este projeto.
          </p>
        ) : (
          <ul className="divide-y divide-border/70">
            {list.map((member) => (
              <MemberRow
                key={member.userId}
                member={member}
                busy={busy}
                onRoleChange={(role) => changeRole.mutate({ userId: member.userId, role })}
                onRemove={() => remove.mutate(member.userId)}
              />
            ))}
          </ul>
        )}
        {candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Todos os usuários ativos já são membros ou administradores. Crie novos usuários em
            Administração → Usuários.
          </p>
        ) : (
          <AddMemberForm
            candidates={candidates}
            pending={add.isPending}
            onAdd={(userId, role) => add.mutate({ userId, role })}
          />
        )}
      </div>
    </SettingsSection>
  );
}

function AddMemberForm({
  candidates,
  pending,
  onAdd,
}: {
  readonly candidates: readonly Candidate[];
  readonly pending: boolean;
  readonly onAdd: (userId: string, role: ProjectRole) => void;
}) {
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<ProjectRole>("developer");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (userId === "") {
      return;
    }
    onAdd(userId, role);
    setUserId("");
  };
  return (
    <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={submit}>
      <div className="flex-1 space-y-2">
        <Label htmlFor="member-user">Pessoa</Label>
        <Select value={userId} onValueChange={setUserId}>
          <SelectTrigger id="member-user" className="w-full">
            <SelectValue placeholder="Escolha um usuário" />
          </SelectTrigger>
          <SelectContent>
            {candidates.map((candidate) => (
              <SelectItem key={candidate.id} value={candidate.id}>
                {candidate.name} · {candidate.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="member-role">Papel</Label>
        <ProjectRoleSelect id="member-role" value={role} onChange={setRole} />
      </div>
      <Button type="submit" disabled={pending || userId === ""}>
        <UserPlusIcon aria-hidden />
        Adicionar
      </Button>
    </form>
  );
}
