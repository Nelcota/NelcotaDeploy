import { ChevronDownIcon } from "lucide-react";
import type { ComponentProps } from "react";

import { UserAvatar } from "@/web/components/account/user-avatar";
import { ROLE_LABELS } from "@/web/components/layout/labels";
import type { SessionUser } from "@/web/functions/session.functions";

// Radix passes the trigger props and ref through `asChild`, so they must reach the button.
/** Avatar, name and role that open the account menu. */
export function AccountButton({
  user,
  ...triggerProps
}: { readonly user: SessionUser } & ComponentProps<"button">) {
  return (
    <button
      {...triggerProps}
      type="button"
      aria-label={`Conta de ${user.name}`}
      className="flex shrink-0 items-center gap-3 rounded-full py-1 pr-2 pl-1 transition-colors hover:bg-well focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <UserAvatar name={user.name} image={user.image} />
      <span className="hidden min-w-0 text-left md:block">
        <span className="block max-w-36 truncate text-sm font-medium">{user.name}</span>
        <span className="block text-xs text-faint">{ROLE_LABELS[user.role]}</span>
      </span>
      <ChevronDownIcon aria-hidden className="hidden size-4 text-muted-foreground md:block" />
    </button>
  );
}
