import { describe, expect, test } from "bun:test";

import { type DomainUptime, describeUptime } from "./uptime-state";

const NOW = new Date("2026-11-02T12:00:00Z");
const BASE: DomainUptime = {
  hostname: "api.example.com",
  status: "up",
  uptimeLastDayPercent: 99.5,
  uptimeLastWeekPercent: 100,
  lastResponseTimeInMs: 120,
  lastReason: null,
  certificateExpiresAt: null,
  recent: [],
};

describe("describeUptime", () => {
  test("shows an answering domain as up with its figures", () => {
    const view = describeUptime(BASE, NOW);

    expect(view.label).toBe("No ar");
    expect(view.tone).toBe("success");
    expect(view.figures).toContain("em 24 h");
    expect(view.figures).toContain("resposta em 120 ms");
  });

  test("shows a domain that stopped answering as down, with the reason", () => {
    const view = describeUptime({ ...BASE, status: "down", lastReason: "timeout" }, NOW);

    expect(view.label).toBe("Fora do ar");
    expect(view.tone).toBe("warning");
    expect(view.failure).toBe("Não respondeu em 10 segundos.");
  });

  test("shows no figures before the first check", () => {
    const view = describeUptime(
      { ...BASE, status: "unknown", uptimeLastDayPercent: null, uptimeLastWeekPercent: null },
      NOW,
    );

    expect(view.label).toBe("Verificando");
    expect(view.figures).toBeNull();
  });

  test("warns about a certificate expiring within 14 days", () => {
    const view = describeUptime({ ...BASE, certificateExpiresAt: "2026-11-10T00:00:00Z" }, NOW);

    expect(view.certificate).toEqual({
      text: "Certificado válido até 09/11/2026",
      expiring: true,
    });
  });

  test("shows a certificate far from expiring without a warning", () => {
    const view = describeUptime({ ...BASE, certificateExpiresAt: "2027-02-01T12:00:00Z" }, NOW);

    expect(view.certificate?.expiring).toBe(false);
  });

  test("says when a certificate already expired", () => {
    const view = describeUptime({ ...BASE, certificateExpiresAt: "2026-10-01T12:00:00Z" }, NOW);

    expect(view.certificate?.text).toBe("Certificado expirou em 01/10/2026");
  });

  test("shows nothing about a certificate that was never read", () => {
    expect(describeUptime(BASE, NOW).certificate).toBeNull();
  });
});
