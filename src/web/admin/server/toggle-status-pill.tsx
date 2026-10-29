import { StatusPill } from "@/web/components/layout/status-badge";

/** Green pill when a feature is on, and a warning or danger pill when it is off. */
export function ToggleStatusPill({
  on,
  onLabel,
  offLabel,
  offTone,
}: {
  readonly on: boolean;
  readonly onLabel: string;
  readonly offLabel: string;
  readonly offTone: "warning" | "danger";
}) {
  return <StatusPill tone={on ? "success" : offTone} label={on ? onLabel : offLabel} />;
}
