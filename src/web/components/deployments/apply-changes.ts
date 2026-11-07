/**
 * Tells whether applying saved variables or domains can be requested now.
 *
 * @param state - `pending` comes from the server; `canRedeploy` means the user may redeploy and
 * there is a live deployment; `requested` means a production deployment or apply request is active.
 * @returns True when the apply button can be enabled.
 */
export function shouldOfferApply(state: {
  readonly pending: boolean;
  readonly canRedeploy: boolean;
  readonly requested: boolean;
}): boolean {
  return state.pending && state.canRedeploy && state.requested === false;
}
