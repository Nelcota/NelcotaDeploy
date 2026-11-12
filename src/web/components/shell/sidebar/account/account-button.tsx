import type { ComponentProps } from "react";

import { UserAvatar } from "@/web/components/account/user-avatar";
import { ROLE_LABELS } from "@/web/components/layout/labels";
import { cn } from "@/web/components/ui/class-names";
import type { SessionUser } from "@/web/functions/session.functions";

// Radix passes the trigger props and ref through `asChild`, so they must reach the button.
/** Avatar, name and role that open the account menu. */
export function AccountButton({
  user,
  collapsed,
  ...triggerProps
}: { readonly user: SessionUser; readonly collapsed: boolean } & ComponentProps<"button">) {
  return (
    <button
      {...triggerProps}
      type="button"
      aria-label={`Conta de ${user.name}`}
      className={cn(
        "flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-lg py-1.5 text-sidebar-foreground transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none data-[state=open]:bg-sidebar-accent",
        collapsed ? "justify-center" : "px-2",
      )}
    >
      <UserAvatar
        name={user.name}
        image={user.image}
        className="size-8"
        fallbackClassName="bg-sidebar-accent text-sidebar-foreground"
      />
      {collapsed ? null : (
        <>
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate text-sm leading-5 font-semibold">{user.name}</span>
            <span className="block truncate text-xs leading-4 text-faint">
              {ROLE_LABELS[user.role]}
            </span>
          </span>
          <span aria-hidden className="solar-[alt-arrow-up-linear] size-4 shrink-0 text-faint" />
        </>
      )}
    </button>
  );
}
