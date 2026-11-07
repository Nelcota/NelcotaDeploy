import { DATABASE_ENGINES, type DatabaseEngineName } from "@/shared/schemas/database.schema";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";

import { ENGINE_LABELS } from "../database-state";
import { EngineLogo } from "../engine-logo";
const ERROR_ID = "database-key-error";
export function EnvironmentKeyField({
  value,
  error,
  onChange,
  candidates,
}: {
  readonly value: string;
  readonly error: string | null;
  readonly onChange: (value: string) => void;
  readonly candidates: readonly string[];
}) {
  return (
    <div className="flex-1 space-y-2">
      <Label htmlFor="database-key">Variável com a URL de conexão</Label>
      <Input
        id="database-key"
        list="database-key-suggestions"
        className="font-mono"
        autoComplete="off"
        aria-invalid={error != null}
        aria-describedby={error == null ? undefined : ERROR_ID}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <datalist id="database-key-suggestions">
        {candidates.map((candidate) => (
          <option key={candidate} value={candidate} />
        ))}
      </datalist>
      <p id={ERROR_ID} aria-live="polite" className="text-sm text-destructive empty:hidden">
        {error ?? ""}
      </p>
    </div>
  );
}

export function EngineSelect({
  engine,
  onChange,
}: {
  readonly engine: DatabaseEngineName;
  readonly onChange: (engine: DatabaseEngineName) => void;
}) {
  return (
    <div className="space-y-2 sm:w-44">
      <Label htmlFor="database-engine">Banco</Label>
      <Select
        value={engine}
        onValueChange={(selected) => {
          const next = DATABASE_ENGINES.find((candidate) => candidate === selected);
          if (next != null) {
            onChange(next);
          }
        }}
      >
        <SelectTrigger id="database-engine" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DATABASE_ENGINES.map((name) => (
            <SelectItem key={name} value={name}>
              <EngineLogo engine={name} className="size-4" />
              {ENGINE_LABELS[name]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
