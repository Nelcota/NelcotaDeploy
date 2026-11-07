import { EyeIcon, EyeOffIcon, KeyRoundIcon } from "lucide-react";
import { useState } from "react";

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
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";

function TokenValue({ token }: { readonly token: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="space-y-2">
      <Label htmlFor="created-token">Token</Label>
      <Input
        id="created-token"
        type={visible ? "text" : "password"}
        autoComplete="off"
        spellCheck={false}
        readOnly
        className="font-mono"
        value={token}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-pressed={visible}
          onClick={() => setVisible((current) => current === false)}
        >
          {visible ? <EyeOffIcon aria-hidden /> : <EyeIcon aria-hidden />}
          {visible ? "Ocultar token" : "Mostrar token"}
        </Button>
        <CopyButton text={token} label="Copiar token" />
      </div>
    </div>
  );
}

/** Shows a just-created token once, with a ready command for Claude Code. */
export function CreatedTokenDialog({
  token,
  onClose,
}: {
  readonly token: string;
  readonly onClose: () => void;
}) {
  const command = `claude mcp add nelcota --env NELCOTA_MCP_TOKEN=${token} --env DATABASE_PATH=/caminho/para/data/nelcota.db -- bun run /caminho/para/o/repositorio/src/mcp/main.ts`;
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      {/* Shown only once: a stray click or Esc must not throw the token away. */}
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-2xl"
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        <DialogHeader icon={<KeyRoundIcon />}>
          <DialogTitle>Copie o token agora</DialogTitle>
          <DialogDescription>
            Ele não será exibido novamente. Guarde-o em um gerenciador de senhas.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <TokenValue token={token} />
          <details className="space-y-2">
            <summary className="w-fit cursor-pointer rounded-sm text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              Ver exemplo de comando para o Claude Code
            </summary>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-console p-3 font-mono text-xs break-all whitespace-pre-wrap text-console-foreground">
              {command}
            </pre>
            <div className="flex justify-end">
              <CopyButton text={command} label="Copiar comando" />
            </div>
          </details>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Já copiei o token</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
