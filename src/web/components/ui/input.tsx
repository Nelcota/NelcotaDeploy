import * as React from "react";

import { cn } from "./class-names";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-11 py-2 file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-medium w-full min-w-0 rounded-lg border border-input bg-surface-sunken px-3.5 text-sm text-foreground transition-[border-color,box-shadow,background-color] outline-none placeholder:text-muted-foreground/80 hover:border-muted-foreground/40 focus-visible:border-ring focus-visible:bg-surface focus-visible:ring-3 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
