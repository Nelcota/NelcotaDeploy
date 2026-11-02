import type { ConsoleCommand } from "@/console";
import { Tag } from "@/web/components/layout/layout";

import { failureText } from "./console-state";

const STATUS = {
  queued: { label: "Aguardando o worker", tone: "neutral" },
  running: { label: "Rodando", tone: "neutral" },
  succeeded: { label: "Concluído", tone: "success" },
  failed: { label: "Falhou", tone: "warning" },
} as const satisfies Record<ConsoleCommand["status"], { label: string; tone: string }>;

/** One command of the console: what was typed, its state and what it printed. */
export function ConsoleEntry({ command }: { readonly command: ConsoleCommand }) {
  const status = STATUS[command.status];
  const finishedWithCode = command.exitCode == null ? null : `código de saída ${command.exitCode}`;
  const failure = failureText(command);
  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate font-mono text-sm">
          <span aria-hidden className="text-muted-foreground">
            ${" "}
          </span>
          {command.command}
        </code>
        <Tag tone={status.tone}>{status.label}</Tag>
        {finishedWithCode == null ? null : (
          <span className="text-xs text-muted-foreground">{finishedWithCode}</span>
        )}
      </div>
      {command.output === "" ? null : (
        <pre className="max-h-80 overflow-auto rounded-lg bg-console p-3 font-mono text-xs whitespace-pre-wrap text-console-foreground">
          {command.output}
        </pre>
      )}
      {failure == null ? null : <p className="text-sm text-warning">{failure}</p>}
    </li>
  );
}
