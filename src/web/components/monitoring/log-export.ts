import { toast } from "sonner";

type ExportableLine = { readonly createdAt: string; readonly message: string };

function linesAsText(lines: readonly ExportableLine[]): string {
  return lines.map((line) => `${line.createdAt} ${line.message}`).join("\n");
}

/** Copies the lines to the clipboard and confirms with a toast. */
export async function copyLines(lines: readonly ExportableLine[]): Promise<void> {
  try {
    await navigator.clipboard.writeText(linesAsText(lines));
    toast.success("Logs copiados");
  } catch {
    toast.error("Não foi possível copiar. Use Baixar para salvar os logs.");
  }
}

/** Saves the lines as a text file. */
export function downloadLines(lines: readonly ExportableLine[], fileName: string): void {
  const url = URL.createObjectURL(
    new Blob([linesAsText(lines)], { type: "text/plain;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
