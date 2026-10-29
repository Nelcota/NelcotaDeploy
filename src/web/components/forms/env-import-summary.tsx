import type { DotenvEntry, DotenvProblem } from "@/shared/dotenv";
import { pluralize } from "@/shared/format";

const MAX_PROBLEMS_SHOWN = 5;

/** Live summary of how many pasted lines are ready and why the others are ignored. */
export function EnvImportSummary({
  id,
  entries,
  problems,
}: {
  readonly id: string;
  readonly entries: readonly DotenvEntry[];
  readonly problems: readonly DotenvProblem[];
}) {
  return (
    <div
      id={id}
      aria-live="polite"
      className="space-y-1 rounded-lg bg-card px-3 py-2.5 text-sm ring-1 ring-border ring-inset"
    >
      <p>
        {entries.length === 1 ? "1 variável pronta" : `${entries.length} variáveis prontas`}
        {problems.length > 0
          ? ` · ${pluralize(problems.length, "linha ignorada", "linhas ignoradas")}`
          : ""}
      </p>
      {problems.slice(0, MAX_PROBLEMS_SHOWN).map((problem) => (
        <p key={problem.line} className="text-xs text-destructive">
          Linha {problem.line}: {problem.reason}
        </p>
      ))}
    </div>
  );
}
