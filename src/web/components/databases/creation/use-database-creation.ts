import { type FormEvent, useState } from "react";

import {
  type DatabaseEngineName,
  type DatabaseInput,
  databaseInputSchema,
  MAX_DATABASES_PER_PROJECT,
} from "@/shared/schemas/database.schema";
import { toUserMessage } from "@/web/components/layout/error-message";

import { detectDatabaseEngine, suggestDatabaseDefaults } from "./database-defaults";
import { useDatabaseDefaults } from "./use-database-defaults";

type CreationOptions = {
  readonly projectId: string;
  readonly databases: readonly { readonly environmentKey: string }[];
  readonly pending: boolean;
  readonly onAdd: (input: DatabaseInput, expectedServerId: string) => Promise<unknown>;
};

/** Stages a creation against the detected server; only confirmation invokes the write action. */
export function useDatabaseCreation(options: CreationOptions) {
  const defaults = useDatabaseDefaults(options.projectId);
  const usedKeys = [
    ...(defaults.variables.data?.map((variable) => variable.key) ?? []),
    ...options.databases.map((database) => database.environmentKey),
  ];
  const [selectedEngine, setSelectedEngine] = useState<DatabaseEngineName | null>(null);
  const engine =
    selectedEngine ?? detectDatabaseEngine({ usedKeys, templateKeys: defaults.templateKeys });
  const suggestion = suggestDatabaseDefaults({
    engine,
    usedKeys,
    templateKeys: defaults.templateKeys,
  });
  const [customKey, setCustomKey] = useState<string | null>(null);
  const environmentKey = customKey ?? suggestion.environmentKey;
  const [error, setError] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState<{
    readonly input: DatabaseInput;
    readonly serverId: string;
    readonly serverName: string;
  } | null>(null);
  const configurationError =
    defaults.variables.error ?? defaults.servers.error ?? defaults.project.error;
  const limited = options.databases.length >= MAX_DATABASES_PER_PROJECT;
  const canReview =
    options.pending === false &&
    environmentKey.trim() !== "" &&
    defaults.variables.data != null &&
    defaults.server != null &&
    configurationError == null &&
    limited === false &&
    defaults.template.isFetching === false;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canReview === false || defaults.server == null) {
      return;
    }
    const parsed = databaseInputSchema.safeParse({ engine, environmentKey });
    if (parsed.success === false) {
      setError(parsed.error.issues.at(0)?.message ?? "Nome de variável inválido");
      return;
    }
    if (usedKeys.includes(parsed.data.environmentKey)) {
      setError("Já existe uma variável ou banco com esse nome. Use a sugestão disponível.");
      return;
    }
    setError(null);
    setReviewed({
      input: parsed.data,
      serverId: defaults.server.id,
      serverName: defaults.server.name,
    });
  };
  const close = () => {
    setReviewed(null);
    setError(null);
  };
  const confirm = async () => {
    if (reviewed == null || options.pending) {
      return;
    }
    try {
      await options.onAdd(reviewed.input, reviewed.serverId);
      close();
      setCustomKey(null);
    } catch (failure) {
      setError(
        toUserMessage(
          failure,
          "Não foi possível criar o banco. Volte e confira a configuração antes de tentar novamente.",
        ),
      );
    }
  };
  const changeEngine = (next: DatabaseEngineName) => {
    setSelectedEngine(next);
    setError(null);
  };
  const changeKey = (value: string) => {
    setCustomKey(value);
    setSelectedEngine(engine);
    setError(null);
  };
  const resetKey = () => {
    setCustomKey(null);
    setError(null);
  };
  return {
    defaults,
    suggestion,
    engine,
    environmentKey,
    error,
    reviewed,
    customKey,
    configurationError,
    limited,
    canReview,
    submit,
    close,
    confirm,
    changeEngine,
    changeKey,
    resetKey,
  };
}

export type DatabaseCreation = ReturnType<typeof useDatabaseCreation>;
