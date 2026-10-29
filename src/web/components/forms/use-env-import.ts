import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import type { DotenvEntry } from "@/shared/dotenv";
import {
  type EnvImportResult,
  summarizeEnvImport,
  type VariableSaveOutcome,
} from "@/web/components/forms/env-import-result";
import type { VariableKind } from "@/web/components/forms/env-kind-toggle";
import { saveEnvironmentVariableFn } from "@/web/functions/environment.functions";

function announceImport(result: EnvImportResult): void {
  if (result.failedKeys.length > 0) {
    toast.error(
      `${result.savedCount} importadas. Não foi possível salvar: ${result.failedKeys.join(", ")}. As linhas com erro ficaram no campo.`,
    );
    return;
  }
  toast.success(
    result.savedCount === 1 ? "1 variável importada" : `${result.savedCount} variáveis importadas`,
  );
}

/**
 * Saves pasted variables one by one and reports the result with a toast.
 *
 * @param projectId - Project that receives the variables.
 * @returns `saving` while the import runs, and `importEntries`, which resolves with the summary.
 */
export function useEnvImport(projectId: string) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);

  const saveEntry = async (
    entry: DotenvEntry,
    kind: VariableKind,
  ): Promise<VariableSaveOutcome> => {
    try {
      await saveEnvironmentVariableFn({
        data: {
          projectId,
          variable: { key: entry.key, kind, value: entry.value, availableAtBuild: false },
        },
      });
      return { entry, saved: true };
    } catch (error) {
      console.error("failed to import variable", entry.key, error);
      return { entry, saved: false };
    }
  };

  const importEntries = async (
    entries: readonly DotenvEntry[],
    kind: VariableKind,
  ): Promise<EnvImportResult> => {
    setSaving(true);
    // Array.fromAsync awaits one save at a time: each is an audited write and the list is small.
    const outcomes = await Array.fromAsync(entries, async (entry) => await saveEntry(entry, kind));
    setSaving(false);
    await queryClient.invalidateQueries({ queryKey: ["environment", projectId] });
    const result = summarizeEnvImport(outcomes);
    announceImport(result);
    return result;
  };

  return { saving, importEntries };
}
