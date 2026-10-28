import { describe, expect, test } from "bun:test";

import { expiryFor, tokenState } from "./token-state";

const NOW = new Date("2026-10-28T12:00:00Z");
const MAX_DAYS = 365;

describe("tokenState", () => {
  test("is revoked whatever the expiry", () => {
    const state = tokenState({ revokedAt: "2026-10-01T00:00:00Z", expiresAt: null }, NOW);

    expect(state).toEqual({ tone: "neutral", label: "Revogado" });
  });

  test("is active without an expiry", () => {
    const state = tokenState({ revokedAt: null, expiresAt: null }, NOW);

    expect(state.label).toBe("Ativo");
  });

  test("is expired once the expiry has passed", () => {
    const state = tokenState({ revokedAt: null, expiresAt: "2026-10-28T11:00:00Z" }, NOW);

    expect(state).toEqual({ tone: "danger", label: "Expirado" });
  });

  test("warns within seven days of the expiry", () => {
    const state = tokenState({ revokedAt: null, expiresAt: "2026-11-03T12:00:00Z" }, NOW);

    expect(state).toEqual({ tone: "warning", label: "Expira em breve" });
  });

  test("is active further from the expiry", () => {
    const state = tokenState({ revokedAt: null, expiresAt: "2026-12-28T12:00:00Z" }, NOW);

    expect(state).toEqual({ tone: "success", label: "Ativo" });
  });
});

describe("expiryFor", () => {
  test("adds the days to now", () => {
    expect(expiryFor("90", NOW, MAX_DAYS)).toBe("2027-01-26T12:00:00.000Z");
  });

  test("means no expiry when blank", () => {
    expect(expiryFor("  ", NOW, MAX_DAYS)).toBeNull();
  });

  test.each(["0", "-3", "1.5", "abc", "366"])("rejects %p", (days) => {
    expect(expiryFor(days, NOW, MAX_DAYS)).toBeUndefined();
  });

  test("accepts the maximum", () => {
    expect(expiryFor("365", NOW, MAX_DAYS)).toBe("2027-10-28T12:00:00.000Z");
  });
});
