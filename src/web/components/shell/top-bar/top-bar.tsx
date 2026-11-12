import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { NelcotaMark } from "@/web/components/shell/brand-logo";
import {
  RefreshButton,
  SearchButton,
  SystemStatusButton,
} from "@/web/components/shell/top-bar/top-bar-buttons";

/**
 * Bar above the page with mobile navigation, search, refresh and system status.
 *
 * @param props - `navigation` is the menu button shown on narrow screens.
 */
export function TopBar({
  navigation,
  onSearch,
}: {
  readonly navigation: ReactNode;
  readonly onSearch: () => void;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 bg-background px-4 lg:px-6">
      {navigation}
      <Link
        to="/"
        aria-label="Nelcota Deploy — Painel"
        className="rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none lg:hidden"
      >
        <NelcotaMark aria-hidden className="h-7 w-auto" />
      </Link>
      <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2.5">
        <SearchButton onSearch={onSearch} />
        <RefreshButton />
        <SystemStatusButton />
      </div>
    </header>
  );
}
