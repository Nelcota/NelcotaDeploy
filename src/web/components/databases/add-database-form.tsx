import { PlusIcon } from "lucide-react";

import type { DatabaseInput } from "@/shared/schemas/database.schema";
import { Button } from "@/web/components/ui/button";

import { EngineSelect, EnvironmentKeyField } from "./creation/database-creation-fields";
import { DatabaseCreationNotes } from "./creation/database-creation-notes";
import { DatabaseReviewDialog } from "./creation/database-review-dialog";
import { useDatabaseCreation } from "./creation/use-database-creation";

/** Detects missing connection configuration and reviews the database before provisioning. */
export function AddDatabaseForm(options: {
  readonly pending: boolean;
  readonly onAdd: (input: DatabaseInput, expectedServerId: string) => Promise<unknown>;
  readonly projectId: string;
  readonly databases: readonly { readonly environmentKey: string }[];
}) {
  const creation = useDatabaseCreation(options);
  const { engine, environmentKey, suggestion, error, reviewed } = creation;
  return (
    <>
      <form
        noValidate
        aria-label="Adicionar banco de dados"
        className="space-y-3 bg-well/40 px-5 py-4"
        onSubmit={creation.submit}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <EngineSelect engine={engine} onChange={creation.changeEngine} />
          <EnvironmentKeyField
            value={environmentKey}
            error={error}
            onChange={creation.changeKey}
            candidates={suggestion.candidates}
          />
          <Button type="submit" className="sm:mt-7" disabled={creation.canReview === false}>
            <PlusIcon aria-hidden />
            Revisar criação do banco
          </Button>
        </div>
        <DatabaseCreationNotes creation={creation} />
      </form>
      {reviewed == null ? null : (
        <DatabaseReviewDialog
          input={reviewed.input}
          serverName={reviewed.serverName}
          pending={options.pending}
          error={error}
          onClose={creation.close}
          onConfirm={() => void creation.confirm()}
        />
      )}
    </>
  );
}
