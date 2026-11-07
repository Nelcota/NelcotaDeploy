import { Label } from "@/web/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";

import type { ServerMoveOption } from "./server-move-state";

/** Destination choices exclude the current server and name unavailable alternatives. */
export function ServerTargetSelect({
  servers,
  sourceId,
  value,
  disabled,
  onChange,
}: {
  readonly servers: readonly ServerMoveOption[];
  readonly sourceId: string;
  readonly value: string;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}) {
  const alternatives = servers.filter((server) => server.id !== sourceId);
  const hasReady = alternatives.some((server) => server.status === "ready");
  return (
    <div className="min-w-0 flex-1 space-y-2">
      <Label htmlFor="project-server">Servidor de destino</Label>
      <Select
        value={value}
        onValueChange={onChange}
        disabled={disabled || alternatives.length === 0}
      >
        <SelectTrigger id="project-server" className="w-full">
          <SelectValue placeholder={hasReady ? "Escolha um servidor" : "Nenhum destino pronto"} />
        </SelectTrigger>
        <SelectContent>
          {alternatives.map((server) => (
            <SelectItem key={server.id} value={server.id} disabled={server.status !== "ready"}>
              <span className="truncate">{server.name}</span>
              {server.status === "ready" ? null : (
                <span className="text-muted-foreground">indisponível</span>
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
