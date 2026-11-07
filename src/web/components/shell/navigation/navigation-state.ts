import { trimPathRight } from "@tanstack/react-router";

export type NavigationDestination = {
  readonly href: string;
  readonly to: string;
  readonly params?: Readonly<Record<string, string>>;
  readonly exact?: boolean;
};
type RouteMatcher = (options: {
  readonly to: string;
  readonly fuzzy: boolean;
  readonly includeSearch: false;
  readonly params: Readonly<Record<string, string>>;
}) => false | Readonly<Record<string, unknown>>;

/** Selects the deepest destination accepted by the router's matcher. */
export function activeNavigationHref(
  destinations: readonly NavigationDestination[],
  matches: RouteMatcher,
): string | null {
  if (destinations.length === 0) {
    return null;
  }
  return (
    destinations
      .filter(({ href, to, params, exact }) => {
        if (href.trim() === "" || to.trim() === "") {
          return false;
        }
        const options = {
          fuzzy: exact !== true,
          includeSearch: false,
          params: params ?? {},
        } as const;
        if (matches({ to, ...options }) !== false) {
          return true;
        }
        if (exact !== true) {
          return false;
        }
        // An empty router splat accepts a trailing slash without accepting child pages.
        const withSlash = matches({ to: `${trimPathRight(to)}/$`, ...options });
        return withSlash !== false && withSlash["_splat"] === "";
      })
      .toSorted((first, second) => second.href.length - first.href.length)
      .at(0)?.href ?? null
  );
}
