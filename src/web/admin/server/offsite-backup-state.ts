import { formatTimeAgo } from "@/shared/format";

/** The off-site backup fields the system tab reads. */
type Offsite = {
  readonly configured: boolean;
  readonly status: {
    readonly attemptedAt: string;
    readonly uploadedAt: string | null;
    readonly error: string | null;
  } | null;
};

/**
 * Describes the off-site copies for the system tab.
 *
 * @param offsite - Whether a bucket is configured and the latest upload outcome.
 * @param now - Current time, for relative times.
 * @returns A pill tone and its label.
 */
export function offsiteBackupState(
  offsite: Offsite,
  now: Date,
): { tone: "success" | "warning" | "danger" | "neutral"; label: string } {
  if (offsite.configured === false) {
    return { tone: "warning", label: "Desativada" };
  }
  const status = offsite.status;
  if (status == null) {
    return { tone: "neutral", label: "Aguardando o primeiro backup" };
  }
  if (status.error != null) {
    return { tone: "danger", label: `Falhou ${formatTimeAgo(status.attemptedAt, now)}` };
  }
  return {
    tone: "success",
    label: `Enviada ${formatTimeAgo(status.uploadedAt ?? status.attemptedAt, now)}`,
  };
}
