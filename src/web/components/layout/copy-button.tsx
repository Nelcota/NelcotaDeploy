import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/web/components/ui/button";

const COPIED_FEEDBACK_IN_MS = 2000;

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copiado para a área de transferência");
    return true;
  } catch (error) {
    console.error("clipboard write failed", error);
    toast.error("Não foi possível copiar. Selecione o texto e copie manualmente.");
    return false;
  }
}

/** Small outline button that copies `text`, confirms with a toast and shows "Copiado" briefly. */
export function CopyButton({ text, label }: { readonly text: string; readonly label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (copied === false) {
      return undefined;
    }
    const timer = setTimeout(() => setCopied(false), COPIED_FEEDBACK_IN_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => void copyToClipboard(text).then(setCopied)}
    >
      {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
      {copied ? "Copiado" : label}
    </Button>
  );
}
