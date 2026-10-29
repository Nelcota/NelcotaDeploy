import { CircleCheckIcon, CircleDashedIcon } from "lucide-react";

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
    <div id={id} aria-live="polite" className="space-y-1 text-sm">
      <p className="flex items-center gap-2 text-muted-foreground">
        {entries.length === 0 ? (
          <CircleDashedIcon aria-hidden className="size-4 shrink-0" />
        ) : (
          <CircleCheckIcon aria-hidden className="size-4 shrink-0 text-success" />
        )}
        {entries.length === 1 ? "1 variável pronta" : `${entries.length} variáveis prontas`}
        {problems.length > 0
          ? ` · ${pluralize(problems.length, "linha ignorada", "linhas ignoradas")}`
          : ""}
      </p>
      {problems.slice(0, MAX_PROBLEMS_SHOWN).map((problem) => (
        <p key={problem.line} className="pl-6 text-xs text-destructive">
          Linha {problem.line}: {problem.reason}
        </p>
      ))}
    </div>
  );
}
