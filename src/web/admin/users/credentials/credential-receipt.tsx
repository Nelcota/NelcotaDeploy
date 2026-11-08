import { CopyButton } from "@/web/components/layout/copy-button";
import { Button } from "@/web/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";

import { PasswordInput } from "../password-input";
import type { AccountCredentials } from "./account-defaults";

export function CredentialReceipt({
  credentials,
  title,
  onClose,
}: {
  readonly credentials: AccountCredentials;
  readonly title: string;
  readonly onClose: () => void;
}) {
  const text = `E-mail: ${credentials.email}\nSenha: ${credentials.password}`;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (open === false) {
          onClose();
        }
      }}
    >
      <DialogContent
        showCloseButton={false}
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Guarde as credenciais de {credentials.name} ou envie-as por um canal seguro. Esta senha
            não será mostrada novamente após fechar.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm break-all">{credentials.email}</p>
          <label htmlFor="saved-account-password" className="text-sm font-medium">
            Senha confirmada
          </label>
          <PasswordInput
            props={{
              id: "saved-account-password",
              "aria-describedby": "saved-account-password-hint",
              "aria-invalid": false,
            }}
            value={credentials.password}
            readOnly
          />
          <p id="saved-account-password-hint" className="text-xs text-muted-foreground">
            Disponível somente nesta tela. Nenhuma mensagem será enviada automaticamente.
          </p>
          <CopyButton text={text} label="Copiar e-mail e senha" />
        </div>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            Já guardei as credenciais
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
