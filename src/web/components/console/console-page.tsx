import { PlayIcon, TerminalIcon } from "lucide-react";
import { type FormEvent, useState } from "react";

import { ErrorState, ListSkeleton } from "@/web/components/layout/states";
import { TabHeader } from "@/web/components/projects/project-header";
import { useCan } from "@/web/components/shell/use-permissions";
import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";

import { ConsoleEntry } from "./console-entry";
import { useConsole } from "./use-console";

const MAX_COMMAND_LENGTH = 2000;

/**
 * Runs one-off commands in the project's live container and shows what they printed. Each
 * command is a fresh `sh -c`, not an interactive terminal.
 */
export function ConsolePage({ projectId }: { readonly projectId: string }) {
  const can = useCan();
  if (can("task:write") === false) {
    return (
      <>
        <ConsoleHeader />
        <p role="status" className="text-sm text-muted-foreground">
          Só quem pode criar tasks neste projeto usa o console.
        </p>
      </>
    );
  }
  return <ConsoleBody projectId={projectId} />;
}

function ConsoleHeader() {
  return (
    <TabHeader
      title="Console"
      description="Cada comando roda uma vez no contêiner no ar, com sh -c. O painel acompanha por até 60 segundos; o processo pode continuar depois desse prazo. Programas interativos, como editores, não funcionam aqui."
    />
  );
}

function ConsoleBody({ projectId }: { readonly projectId: string }) {
  const { commands, run } = useConsole(projectId);
  const list = commands.data ?? [];
  const busy =
    run.isPending ||
    list.some((command) => command.status === "queued" || command.status === "running");
  return (
    <>
      <ConsoleHeader />
      {commands.isError ? (
        <ErrorState error={commands.error} onRetry={() => void commands.refetch()} />
      ) : null}
      {commands.data == null && commands.isError === false ? <ListSkeleton rows={2} /> : null}
      <section className="rounded-2xl bg-card px-5 ring-1 ring-border/70 md:px-6">
        {list.length === 0 ? (
          <p className="flex items-center gap-2 py-5 text-sm text-muted-foreground">
            <TerminalIcon aria-hidden className="size-4" />
            Nenhum comando ainda. Os comandos ficam registrados no log de auditoria.
          </p>
        ) : (
          <ol
            aria-label="Comandos recentes"
            aria-live="polite"
            className="divide-y divide-border/70"
          >
            {list.map((command) => (
              <ConsoleEntry key={command.id} command={command} />
            ))}
          </ol>
        )}
        <CommandForm busy={busy} onRun={(command) => run.mutate(command)} />
      </section>
    </>
  );
}

function CommandForm({
  busy,
  onRun,
}: {
  readonly busy: boolean;
  readonly onRun: (command: string) => void;
}) {
  const [command, setCommand] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (command.trim() === "" || busy) {
      return;
    }
    onRun(command);
    setCommand("");
  };
  return (
    <form
      className="flex flex-col gap-3 border-t border-border/60 py-4 sm:flex-row sm:items-end"
      onSubmit={submit}
    >
      <div className="flex-1 space-y-2">
        <Label htmlFor="console-command">Comando</Label>
        <Input
          id="console-command"
          className="font-mono"
          autoComplete="off"
          spellCheck={false}
          maxLength={MAX_COMMAND_LENGTH}
          placeholder="ls -la"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
        />
      </div>
      <Button type="submit" disabled={busy || command.trim() === ""}>
        <PlayIcon aria-hidden />
        {busy ? "Aguarde…" : "Rodar"}
      </Button>
    </form>
  );
}
