import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

import { useTheme } from "@/web/components/shell/theme";

// Unstyled so the toast matches the app surfaces instead of Sonner's saturated rich colors;
// the toast type only colors the icon.
const toastClassNames = {
  toast:
    "group/toast relative flex w-(--width) items-start gap-2.5 rounded-md border border-border bg-popover py-2.5 pr-9 pl-3 text-popover-foreground shadow-[0_8px_24px_-12px_rgb(0_0_0/0.45)]",
  icon: "flex h-5.5 shrink-0 items-center text-muted-foreground",
  content: "flex min-w-0 flex-1 flex-col",
  title: "text-sm font-medium",
  description: "text-xs text-muted-foreground",
  closeButton:
    "absolute top-2.5 right-2 flex size-5.5 items-center justify-center rounded-sm opacity-0 transition-opacity group-hover/toast:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring [&_svg]:size-3.5",
  actionButton:
    "shrink-0 self-center rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground",
  cancelButton:
    "shrink-0 self-center rounded-md bg-well px-2.5 py-1 text-xs font-semibold text-foreground",
  success: "[&_[data-icon]]:text-success",
  error: "[&_[data-icon]]:text-destructive",
  warning: "[&_[data-icon]]:text-warning",
  info: "[&_[data-icon]]:text-brand",
} satisfies NonNullable<ToasterProps["toastOptions"]>["classNames"];

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme();

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      toastOptions={{ unstyled: true, classNames: toastClassNames }}
      // Sonner paints the close button from these variables even when unstyled.
      style={
        {
          "--normal-bg": "transparent",
          "--normal-bg-hover": "var(--well-hover)",
          "--normal-border": "transparent",
          "--normal-border-hover": "transparent",
          "--normal-text": "var(--muted-foreground)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
