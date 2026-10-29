/** How the system indicator should look; each tone maps to one dot color. */
type SystemTone = "checking" | "unknown" | "down" | "busy" | "ok";

/** Dot color of each tone, shared by every status indicator. */
export const SYSTEM_STATUS_DOTS: Readonly<Record<SystemTone, string>> = {
  checking: "bg-faint",
  unknown: "bg-warning",
  down: "bg-destructive",
  busy: "bg-brand motion-safe:animate-pulse",
  ok: "bg-success",
};

type SystemStatusInput = {
  /** The first status request has not answered yet. */
  readonly pending: boolean;
  /** The last status request failed. */
  readonly failed: boolean;
  readonly worker: { readonly online: boolean; readonly dockerAvailable: boolean } | null;
  readonly activeDeployments: number;
};

/**
 * Describes the worker and Docker state for the status indicators, without raising an alarm
 * while the first answer is still on its way.
 *
 * @param input - What the status query knows so far.
 * @returns The label to show and its tone.
 */
export function describeSystemStatus(input: SystemStatusInput): {
  readonly label: string;
  readonly tone: SystemTone;
} {
  if (input.pending) {
    return { label: "Verificando sistema…", tone: "checking" };
  }
  if (input.failed) {
    return { label: "Status indisponível", tone: "unknown" };
  }
  if (input.worker == null || input.worker.online === false) {
    return { label: "Worker parado", tone: "down" };
  }
  if (input.worker.dockerAvailable === false) {
    return { label: "Docker indisponível", tone: "down" };
  }
  if (input.activeDeployments > 0) {
    const label =
      input.activeDeployments === 1
        ? "1 deploy em andamento"
        : `${input.activeDeployments} deploys em andamento`;
    return { label, tone: "busy" };
  }
  return { label: "Sistema operando", tone: "ok" };
}
