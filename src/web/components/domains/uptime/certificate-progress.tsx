import { useState } from "react";

import { formatTimeAgo } from "@/shared/format";
import { useNow } from "@/web/components/clock/use-now";

import { certificateWaitStartedAt } from "./domain-access";

/** Dates an ongoing certificate issue without announcing each clock update. */
export function CertificateProgress({
  failed,
  firstFailureAt,
}: {
  readonly failed: boolean;
  readonly firstFailureAt: string | null;
}) {
  const now = useNow();
  const [firstObservedAt] = useState(() => now.toISOString());
  const waitingSince = certificateWaitStartedAt({ firstFailureAt, firstObservedAt });
  const startedAt = failed ? (firstFailureAt ?? waitingSince) : waitingSince;
  const label = failed ? "Falha detectada" : "Espera observada";

  return (
    <p className="text-sm font-medium tabular-nums">
      {label} <time dateTime={startedAt}>{formatTimeAgo(startedAt, now)}</time>
    </p>
  );
}
