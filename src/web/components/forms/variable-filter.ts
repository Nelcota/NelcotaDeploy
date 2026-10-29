/** Longest search accepted; variable names are short, so anything longer cannot match. */
const MAX_SEARCH_LENGTH = 200;

/**
 * Keeps the variables whose name contains the search, ignoring case and surrounding spaces.
 *
 * @param variables - Variables in display order.
 * @param search - Text typed by the user; empty or blank keeps every variable.
 * @returns The matching variables, in the same order.
 */
export function filterVariablesByKey<Variable extends { readonly key: string }>(
  variables: readonly Variable[],
  search: string,
): readonly Variable[] {
  const needle = search.trim().slice(0, MAX_SEARCH_LENGTH).toUpperCase();
  if (needle === "") {
    return variables;
  }
  return variables.filter((variable) => variable.key.toUpperCase().includes(needle));
}
