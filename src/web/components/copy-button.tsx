import { CopyIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "./ui/button";

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copiado para a área de transferência");
  } catch {
    toast.error("Não foi possível copiar. Selecione o texto e copie manualmente.");
  }
}

/** Small outline button that copies `text` and confirms with a toast. */
export function CopyButton({ text, label }: { readonly text: string; readonly label: string }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={() => void copyToClipboard(text)}>
      <CopyIcon aria-hidden />
      {label}
    </Button>
  );
}
