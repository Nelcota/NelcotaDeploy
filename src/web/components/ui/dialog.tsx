"use client";

import { XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import * as React from "react";

import { Button } from "./button";
import { cn } from "./class-names";

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-[#0d1014]/55 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className,
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
}) {
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          // A sheet rising from the bottom on phones; a centered card from sm up. The content
          // scrolls when it is taller than the screen and the footer stays pinned to its bottom.
          // A scroll container always keeps its bottom padding, so a footer cannot cancel it with
          // a negative margin: the padding goes away when there is a footer, which has its own.
          "fixed inset-x-0 bottom-0 z-50 grid max-h-[calc(100dvh-1rem)] w-full gap-6 overflow-y-auto rounded-t-2xl bg-popover p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-popover-foreground has-data-[slot=dialog-footer]:pb-0 shadow-2xl ring-1 ring-border/70 duration-200 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-bottom data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom",
          "sm:inset-x-auto sm:top-[50%] sm:bottom-auto sm:left-[50%] sm:max-h-[calc(100dvh-4rem)] sm:max-w-lg sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-2xl sm:data-[state=closed]:slide-out-to-bottom-0 sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:slide-in-from-bottom-0 sm:data-[state=open]:zoom-in-95",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="absolute top-4 right-4 flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">Fechar</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

/**
 * Title and description, with an optional icon in a tinted tile beside them. The right
 * padding keeps long titles clear of the close button.
 */
function DialogHeader({
  className,
  icon,
  tone = "default",
  children,
  ...props
}: React.ComponentProps<"div"> & {
  icon?: React.ReactNode;
  tone?: "default" | "destructive";
}) {
  if (icon == null) {
    return (
      <div
        data-slot="dialog-header"
        className={cn("flex flex-col gap-1.5 pr-8 text-left", className)}
        {...props}
      >
        {children}
      </div>
    );
  }
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex items-start gap-4 pr-8 text-left", className)}
      {...props}
    >
      <DialogIcon tone={tone}>{icon}</DialogIcon>
      <div className="flex min-w-0 flex-col gap-1.5 pt-0.5">{children}</div>
    </div>
  );
}

function DialogIcon({
  tone,
  children,
}: {
  tone: "default" | "destructive";
  children: React.ReactNode;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-xl [&_svg]:size-5",
        tone === "destructive" ? "bg-destructive/12 text-destructive" : "bg-brand/12 text-brand",
      )}
    >
      {children}
    </span>
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        // Spans the card edge to edge and stays visible while the content above scrolls.
        "sticky bottom-0 -mx-6 flex flex-col-reverse gap-2 border-t border-border/70 bg-popover/95 px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:flex-row sm:justify-end sm:rounded-b-2xl",
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Fechar</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-xl leading-tight font-semibold tracking-tight", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm leading-relaxed text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
