import { PlusIcon, UsersIcon } from "lucide-react";
import { useState } from "react";

import { Section } from "@/web/components/layout/layout";
import { Button } from "@/web/components/ui/button";

import { CreateUserDialog } from "./create-user-dialog";
import { UserList } from "./user-list";

/** Accounts of the panel: roles, activation and passwords. */
export function UsersTab() {
  const [createOpen, setCreateOpen] = useState(false);
  return (
    <Section
      icon={UsersIcon}
      title="Usuários"
      action={
        <Button onClick={() => setCreateOpen(true)}>
          <PlusIcon aria-hidden />
          Novo usuário
        </Button>
      }
    >
      <UserList />
      {/* Mounted only while open, so a cancelled draft and its password are not kept. */}
      {createOpen ? <CreateUserDialog open onOpenChange={setCreateOpen} /> : null}
    </Section>
  );
}
