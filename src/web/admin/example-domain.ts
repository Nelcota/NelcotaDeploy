const EXAMPLE_BASE_DOMAIN = "apps.exemplo.com";

/**
 * Domain used in the base domain hints: what the admin typed, or a sample while it is empty.
 *
 * @param baseDomain - Text of the base domain field.
 * @returns The trimmed domain, or "apps.exemplo.com" when blank.
 */
export function exampleDomainOf(baseDomain: string): string {
  return baseDomain.trim() === "" ? EXAMPLE_BASE_DOMAIN : baseDomain.trim();
}
