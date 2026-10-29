import type { DotenvEntry } from "@/shared/dotenv";

/** Outcome of saving one pasted variable. */
export type VariableSaveOutcome = { readonly entry: DotenvEntry; readonly saved: boolean };

/** What an import achieved, and what is left to retry. */
export type EnvImportResult = {
  readonly savedCount: number;
  readonly failedKeys: readonly string[];
  /** The failed lines as `.env` text, so importing again does not repeat the saved ones. */
  readonly remainingText: string;
};

/**
 * Sums up the outcome of an import.
 *
 * @param outcomes - One outcome per pasted variable, in paste order.
 * @returns How many were saved, which keys failed and the failed lines as text.
 */
export function summarizeEnvImport(outcomes: readonly VariableSaveOutcome[]): EnvImportResult {
  const failed = outcomes.filter((outcome) => outcome.saved === false).map(({ entry }) => entry);
  return {
    savedCount: outcomes.length - failed.length,
    failedKeys: failed.map((entry) => entry.key),
    remainingText: failed.map((entry) => `${entry.key}=${entry.value}`).join("\n"),
  };
}
