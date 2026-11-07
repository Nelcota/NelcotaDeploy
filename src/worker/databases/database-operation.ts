import type { Database } from "@/db";

/** Cancellation and lease checks shared by operations on a project database. */
export type DatabaseOperation = {
  readonly signal?: AbortSignal;
  readonly assertOwnership?: () => void;
};

/** Refuses work after cancellation or after another worker reclaimed the attempt. */
export function assertDatabaseOperationActive(operation: DatabaseOperation): void {
  operation.assertOwnership?.();
  operation.signal?.throwIfAborted();
}

/** Checks the lease and writes metadata under the same lock across worker processes. */
export function recordDatabaseOperationOutcome(
  operation: DatabaseOperation & { readonly database: Database },
  write: () => void,
): void {
  operation.database.transaction(
    () => {
      assertDatabaseOperationActive(operation);
      write();
    },
    { behavior: "immediate" },
  );
}
