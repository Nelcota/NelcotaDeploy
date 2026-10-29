import { LoaderCircleIcon } from "lucide-react";

import { CopyButton } from "@/web/components/layout/copy-button";

/** The one command an admin runs on a new server, and what happens after it. */
export function InstallCommand({ command }: { readonly command: string }) {
  return (
    <div className="space-y-3 rounded-lg bg-muted/40 p-4 ring-1 ring-border/70">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Entre na VPS por SSH como root (ou um usuário com sudo).</li>
        <li>Cole o comando abaixo e aguarde terminar. Ele instala o Docker e libera o painel.</li>
        <li>Pronto: o painel se conecta e prepara o servidor sozinho.</li>
      </ol>
      <div className="flex items-start gap-2">
        {/* Focusable so keyboard users can scroll through the command. */}
        <pre
          tabIndex={0}
          aria-label="Comando de instalação"
          className="max-h-40 min-w-0 flex-1 overflow-auto rounded-md bg-background p-3 font-mono text-xs ring-1 ring-border/70 focus-visible:outline-2 focus-visible:outline-ring"
        >
          {command}
        </pre>
        <CopyButton text={command} label="Copiar comando" />
      </div>
      <p aria-live="polite" className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircleIcon aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
        Aguardando o servidor ficar acessível…
      </p>
    </div>
  );
}
