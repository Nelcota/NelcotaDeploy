import { describe, expect, test } from "bun:test";

import { HistoryIcon, RocketIcon, UserRoundIcon, WebhookIcon } from "lucide-react";

import { actorOf, areaOf, targetTypeLabelOf } from "./audit-labels";

describe("areaOf", () => {
  test("uses the icon of the area before the dot", () => {
    expect(areaOf("deployment.requested").icon).toBe(RocketIcon);
  });

  test("falls back to the history icon for an unknown area", () => {
    expect(areaOf("billing.charged").icon).toBe(HistoryIcon);
  });

  test("falls back to the history icon for an empty action", () => {
    expect(areaOf("").icon).toBe(HistoryIcon);
  });
});

describe("actorOf", () => {
  test("describes a known actor type", () => {
    expect(actorOf("webhook")).toEqual({ label: "Webhook", icon: WebhookIcon });
  });

  test("keeps the raw type with a person icon when unknown", () => {
    expect(actorOf("robot")).toEqual({ label: "robot", icon: UserRoundIcon });
  });
});

describe("targetTypeLabelOf", () => {
  test("translates a known target type", () => {
    expect(targetTypeLabelOf("environment_variable")).toBe("Variável");
  });

  test("keeps the raw type when unknown", () => {
    expect(targetTypeLabelOf("invoice")).toBe("invoice");
  });
});
