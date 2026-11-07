import { ImageUpIcon, LogOutIcon, MoonIcon, ShieldCheckIcon, SunIcon } from "lucide-react";
import { useState } from "react";

import { ProfilePhotoDialog } from "@/web/components/account/profile-photo-dialog";
import { TwoFactorDialog } from "@/web/components/account/two-factor-dialog";
import { ROLE_LABELS } from "@/web/components/layout/labels";
import { useTheme } from "@/web/components/shell/theme";
import { AccountButton } from "@/web/components/shell/top-bar/account-button";
import { useSignOut } from "@/web/components/shell/top-bar/use-sign-out";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/web/components/ui/dropdown-menu";
import type { SessionUser } from "@/web/functions/session.functions";

/** Avatar menu with the profile photo, two-factor authentication, the theme switch and sign out. */
export function AccountMenu({ user }: { readonly user: SessionUser }) {
  const { theme, toggleTheme } = useTheme();
  const signOut = useSignOut();
  const [photoOpen, setPhotoOpen] = useState(false);
  const [twoFactorOpen, setTwoFactorOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <AccountButton user={user} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="font-normal">
            <p className="truncate font-semibold">{user.name}</p>
            <p className="truncate text-sm text-muted-foreground">
              {user.email} · {ROLE_LABELS[user.role]}
            </p>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setPhotoOpen(true)}>
            <ImageUpIcon aria-hidden />
            Alterar foto de perfil
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setTwoFactorOpen(true)}>
            <ShieldCheckIcon aria-hidden />
            {user.twoFactorEnabled
              ? "Verificação em duas etapas: ativa"
              : "Ativar verificação em duas etapas"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={toggleTheme}>
            {theme === "dark" ? <SunIcon aria-hidden /> : <MoonIcon aria-hidden />}
            {theme === "dark" ? "Ativar tema claro" : "Ativar tema escuro"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void signOut()}>
            <LogOutIcon aria-hidden />
            Sair da conta
          </DropdownMenuItem>
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
