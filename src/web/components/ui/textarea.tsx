import * as React from "react";

import { cn } from "./class-names";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-24 py-2.5 leading-relaxed w-full min-w-0 rounded-lg border border-transparent bg-secondary ring-1 ring-border ring-inset px-3.5 text-sm text-foreground transition-[border-color,box-shadow,background-color] outline-none placeholder:text-muted-foreground/80 hover:ring-input focus-visible:ring-2 focus-visible:ring-ring focus-visible:bg-surface focus-visible:ring-3 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
