import { PlusIcon } from "lucide-react";
import { type FormEvent, useState } from "react";

import {
  DATABASE_ENGINES,
  type DatabaseEngineName,
  type DatabaseInput,
  databaseInputSchema,
} from "@/shared/schemas/database.schema";
import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";

import { DEFAULT_ENVIRONMENT_KEYS, ENGINE_LABELS } from "./database-state";

const ERROR_ID = "database-key-error";

/** Inline form at the top of the database list: engine, variable name and submit. */
export function AddDatabaseForm({
  pending,
  onAdd,
}: {
  readonly pending: boolean;
  readonly onAdd: (input: DatabaseInput) => void;
}) {
  const [engine, setEngine] = useState<DatabaseEngineName>("postgres");
  const [environmentKey, setEnvironmentKey] = useState(DEFAULT_ENVIRONMENT_KEYS.postgres);
  const [error, setError] = useState<string | null>(null);
  const changeEngine = (next: DatabaseEngineName) => {
    setEngine(next);
    setEnvironmentKey(DEFAULT_ENVIRONMENT_KEYS[next]);
    setError(null);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = databaseInputSchema.safeParse({ engine, environmentKey });
    if (parsed.success === false) {
      setError(parsed.error.issues[0]?.message ?? "Nome de variável inválido");
      return;
    }
    setError(null);
    onAdd(parsed.data);
  };
  return (
    <form
      noValidate
      aria-label="Adicionar banco de dados"
      className="flex flex-col gap-3 bg-well/40 px-5 py-4 sm:flex-row sm:items-start"
      onSubmit={submit}
    >
      <EngineSelect engine={engine} onChange={changeEngine} />
      <EnvironmentKeyField value={environmentKey} error={error} onChange={setEnvironmentKey} />
      <Button type="submit" className="sm:mt-7" disabled={pending || environmentKey.trim() === ""}>
        <PlusIcon aria-hidden />
        Criar banco
      </Button>
    </form>
  );
}

function EnvironmentKeyField({
  value,
  error,
  onChange,
}: {
  readonly value: string;
  readonly error: string | null;
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className="flex-1 space-y-2">
      <Label htmlFor="database-key">Variável com a URL de conexão</Label>
      <Input
        id="database-key"
        className="font-mono"
        autoComplete="off"
        aria-invalid={error != null}
        aria-describedby={error == null ? undefined : ERROR_ID}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <p id={ERROR_ID} aria-live="polite" className="text-sm text-destructive empty:hidden">
        {error ?? ""}
      </p>
    </div>
  );
}

function EngineSelect({
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
              {ENGINE_LABELS[name]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
