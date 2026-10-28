import { LoaderCircleIcon, RefreshCwIcon } from "lucide-react";

import { Button } from "./ui/button";

/**
 * Notice shown after a change that only reaches the application when its container is
 * recreated, with the button that does it.
 */
export function ApplyChangesBanner({
  message,
  applying,
  onApply,
}: {
  readonly message: string;
  readonly applying: boolean;
  readonly onApply: () => void;
}) {
  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-xl bg-warning/8 px-5 py-4 ring-1 ring-warning/25 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="flex items-start gap-2 text-sm">
        <RefreshCwIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
        {message}
      </p>
      <Button size="sm" disabled={applying} onClick={onApply}>
        {applying ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
        Aplicar agora
      </Button>
    </div>
  );
}
