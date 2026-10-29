import { ChevronRightIcon } from "lucide-react";

/** Collapsed note on how secrets are stored and what a redeploy does. */
export function SecretsHelp() {
  return (
    <details className="group text-sm text-muted-foreground">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon
          aria-hidden
          className="size-3.5 transition-transform group-open:rotate-90"
        />
        Saiba mais sobre secrets e redeploy
      </summary>
      <p className="mt-2 max-w-2xl text-xs leading-relaxed">
        Secrets são criptografados com AES-256-GCM e nunca voltam para o navegador. O redeploy
        recria o contêiner com a imagem atual e as variáveis salvas, sem novo build.
      </p>
    </details>
  );
}
