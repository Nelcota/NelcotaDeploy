/**
 * Tells whether to offer applying saved variables or domains with a redeploy.
 *
 * @param state - `pending` comes from the server; `canRedeploy` means the user may redeploy and
 * there is a live deployment; `requested` means a redeploy was already queued from this page.
 * @returns True when the banner should be shown.
 */
export function shouldOfferApply(state: {
  readonly pending: boolean;
  readonly canRedeploy: boolean;
  readonly requested: boolean;
}): boolean {
  return state.pending && state.canRedeploy && state.requested === false;
}
