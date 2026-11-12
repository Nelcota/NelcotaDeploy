import { useState } from "react";

import { ProfilePhotoDialog } from "@/web/components/account/profile-photo-dialog";
import { TwoFactorDialog } from "@/web/components/account/two-factor-dialog";
import { ROLE_LABELS } from "@/web/components/layout/labels";
import { AccountButton } from "@/web/components/shell/sidebar/account/account-button";
import { useTheme } from "@/web/components/shell/theme";
import { useSignOut } from "@/web/components/shell/top-bar/use-sign-out";
import { cn } from "@/web/components/ui/class-names";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/web/components/ui/dropdown-menu";
import type { SessionUser } from "@/web/functions/session.functions";

function AccountMenuItems({
  user,
  onPhoto,
  onTwoFactor,
}: {
  readonly user: SessionUser;
  readonly onPhoto: () => void;
  readonly onTwoFactor: () => void;
}) {
  const { theme, toggleTheme } = useTheme();
  const signOut = useSignOut();
  return (
    <>
      <DropdownMenuLabel className="font-normal">
        <p className="truncate font-semibold">{user.name}</p>
        <p className="truncate text-sm text-muted-foreground">
          {user.email} · {ROLE_LABELS[user.role]}
        </p>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={onPhoto}>
        <span aria-hidden className="solar-[gallery-add-linear] size-4 shrink-0" />
        Alterar foto de perfil
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={onTwoFactor}>
        <span aria-hidden className="solar-[shield-check-linear] size-4 shrink-0" />
        {user.twoFactorEnabled
          ? "Verificação em duas etapas: ativa"
          : "Ativar verificação em duas etapas"}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={toggleTheme}>
        <span
          aria-hidden
          className={cn(
            "size-4 shrink-0",
            theme === "dark" ? "solar-[sun-2-linear]" : "solar-[moon-linear]",
          )}
        />
        {theme === "dark" ? "Ativar tema claro" : "Ativar tema escuro"}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void signOut()}>
        <span aria-hidden className="solar-[logout-2-linear] size-4 shrink-0" />
        Sair da conta
      </DropdownMenuItem>
    </>
  );
}

/** Avatar menu with the profile photo, two-factor authentication, the theme switch and sign out. */
export function AccountMenu({
  user,
  collapsed,
}: {
  readonly user: SessionUser;
  readonly collapsed: boolean;
}) {
  const [photoOpen, setPhotoOpen] = useState(false);
  const [twoFactorOpen, setTwoFactorOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <AccountButton user={user} collapsed={collapsed} />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side={collapsed ? "right" : "top"}
          align={collapsed ? "end" : "start"}
          sideOffset={8}
          collisionPadding={8}
          className="w-64 max-w-(--radix-dropdown-menu-content-available-width) rounded-xl"
        >
          <AccountMenuItems
            user={user}
            onPhoto={() => setPhotoOpen(true)}
            onTwoFactor={() => setTwoFactorOpen(true)}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      <ProfilePhotoDialog user={user} open={photoOpen} onOpenChange={setPhotoOpen} />
      <TwoFactorDialog
        enabled={user.twoFactorEnabled}
        open={twoFactorOpen}
        onOpenChange={setTwoFactorOpen}
      />
    </>
  );
}
