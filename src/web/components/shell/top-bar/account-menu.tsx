import { ImageUpIcon, LogOutIcon, MoonIcon, SunIcon } from "lucide-react";
import { useState } from "react";

import { ProfilePhotoDialog } from "@/web/components/account/profile-photo-dialog";
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

/** Avatar menu with the profile photo, the theme switch and sign out. */
export function AccountMenu({ user }: { readonly user: SessionUser }) {
  const { theme, toggleTheme } = useTheme();
  const signOut = useSignOut();
  const [photoOpen, setPhotoOpen] = useState(false);
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
            Foto de perfil
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={toggleTheme}>
            {theme === "dark" ? <SunIcon aria-hidden /> : <MoonIcon aria-hidden />}
            {theme === "dark" ? "Tema claro" : "Tema escuro"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void signOut()}>
            <LogOutIcon aria-hidden />
            Sair
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ProfilePhotoDialog user={user} open={photoOpen} onOpenChange={setPhotoOpen} />
    </>
  );
}
