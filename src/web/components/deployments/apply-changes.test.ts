import { describe, expect, test } from "bun:test";

import { shouldOfferApply } from "./apply-changes";

describe("shouldOfferApply", () => {
  test("offers when changes are pending and a redeploy is possible", () => {
    expect(shouldOfferApply({ pending: true, canRedeploy: true, requested: false })).toBe(true);
  });

  test("does not offer without pending changes", () => {
    expect(shouldOfferApply({ pending: false, canRedeploy: true, requested: false })).toBe(false);
  });

  test("does not offer when the user cannot redeploy", () => {
    expect(shouldOfferApply({ pending: true, canRedeploy: false, requested: false })).toBe(false);
  });

  test("does not offer again once a redeploy was queued", () => {
    expect(shouldOfferApply({ pending: true, canRedeploy: true, requested: true })).toBe(false);
  });
});
