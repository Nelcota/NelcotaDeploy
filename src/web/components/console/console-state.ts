/** Fields of a command that decide what its entry says about how it ended. */
type FinishedCommand = {
  readonly status: "queued" | "running" | "succeeded" | "failed";
  readonly exitCode: number | null;
  readonly errorMessage: string | null;
};

// The worker writes these in English; the console shows them in Portuguese.
const KNOWN_FAILURES: readonly (readonly [prefix: string, text: string])[] = [
  ["Stopped after", "Parado depois de 60 segundos."],
  ["Interrupted because the worker", "Interrompido porque o worker reiniciou. Rode de novo."],
  ["The project has no live container", "O projeto não tem contêiner no ar."],
];

/**
 * Explains why a command failed, in Portuguese, when its exit code alone does not say it.
 *
 * @param command - Status, exit code and the worker's message.
 * @returns The explanation, or null when there is nothing to add.
 */
export function failureText(command: FinishedCommand): string | null {
  if (command.status !== "failed" || command.errorMessage == null) {
    return null;
  }
  const known = KNOWN_FAILURES.find(
    ([prefix]) => command.errorMessage?.startsWith(prefix) === true,
  );
  if (known != null) {
    return known[1];
  }
  // A non-zero exit code is already shown next to the command.
  if (command.exitCode != null) {
    return null;
  }
  return "Não foi possível rodar o comando no contêiner.";
}
