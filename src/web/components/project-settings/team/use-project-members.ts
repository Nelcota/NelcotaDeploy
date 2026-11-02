import { useQuery } from "@tanstack/react-query";

import type { ProjectRole } from "@/shared/roles";
import { useAction } from "@/web/components/layout/use-action";
import {
  addProjectMemberFn,
  listProjectMembersFn,
  removeProjectMemberFn,
  updateProjectMemberRoleFn,
} from "@/web/functions/members/members.functions";

type MemberChange = { readonly userId: string; readonly role: ProjectRole };

/** A project's members, the users that could join it and the actions that change them. */
export function useProjectMembers(projectId: string) {
  const members = useQuery({
    queryKey: ["project-members", projectId],
    queryFn: () => listProjectMembersFn({ data: { projectId } }),
  });
  const invalidate = [["project-members", projectId]] as const;
  const add = useAction({
    action: (change: MemberChange) => addProjectMemberFn({ data: { projectId, ...change } }),
    successMessage: "Membro adicionado",
    invalidate,
  });
  const changeRole = useAction({
    action: (change: MemberChange) => updateProjectMemberRoleFn({ data: { projectId, ...change } }),
    successMessage: "Papel atualizado",
    invalidate,
  });
  const remove = useAction({
    action: (userId: string) => removeProjectMemberFn({ data: { projectId, userId } }),
    successMessage: "Membro removido",
    invalidate,
  });
  return { members, add, changeRole, remove };
}
