import { LogOutIcon, ShieldCheckIcon } from "lucide-react";
import { useState } from "react";

import { useSignOut } from "@/web/components/shell/top-bar/use-sign-out";
import { Button } from "@/web/components/ui/button";

import { TwoFactorDialog } from "./two-factor-dialog";

/**
 * Shown instead of the panel to an admin who must turn on two-factor authentication. The
 * server refuses their requests meanwhile, so this screen is only a guide, not the guard.
 */
export function TwoFactorRequired() {
  const [open, setOpen] = useState(false);
  const signOut = useSignOut();
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center gap-5 px-4">
      <ShieldCheckIcon aria-hidden className="size-10 text-brand" />
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Ative a verificação em duas etapas
        </h1>
        <p className="text-muted-foreground">
          Esta organização exige que administradores entrem com senha e um código do app
          autenticador. Configure agora para continuar usando o painel.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setOpen(true)}>Configurar agora</Button>
        <Button variant="ghost" onClick={() => void signOut()}>
          <LogOutIcon aria-hidden />
          Sair
        </Button>
      </div>
      <TwoFactorDialog enabled={false} open={open} onOpenChange={setOpen} />
    </main>
  );
}
