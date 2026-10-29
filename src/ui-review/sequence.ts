/**
 * Runs `step` on each item, starting the next only after the previous one finishes, and
 * returns the results in item order.
 *
 * @remarks
 * For steps that share one resource, like a single browser tab, and so cannot run in parallel.
 */
export async function mapInSequence<Item, Result>(
  items: readonly Item[],
  step: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  const [first, ...rest] = items;
  if (first === undefined) {
    return [];
  }
  const firstResult = await step(first);
  const restResults = await mapInSequence(rest, step);
  return [firstResult, ...restResults];
}
