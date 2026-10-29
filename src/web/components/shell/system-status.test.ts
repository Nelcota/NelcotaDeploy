import { describe, expect, test } from "bun:test";

import { describeSystemStatus } from "@/web/components/shell/system-status";

const ONLINE = { online: true, dockerAvailable: true };
const BASE = { pending: false, failed: false, worker: ONLINE, activeDeployments: 0 };

describe("describeSystemStatus", () => {
  test("says it is checking while the first answer has not arrived", () => {
    const status = describeSystemStatus({ ...BASE, pending: true, worker: null });

    expect(status).toEqual({ label: "Verificando sistema…", tone: "checking" });
  });

  test("says the status is unavailable when the request failed", () => {
    const status = describeSystemStatus({ ...BASE, failed: true, worker: null });

    expect(status).toEqual({ label: "Status indisponível", tone: "unknown" });
  });

  test("reports a stopped worker when there is no heartbeat", () => {
    const status = describeSystemStatus({ ...BASE, worker: null });

    expect(status.tone).toBe("down");
    expect(status.label).toBe("Worker parado");
  });

  test("reports a stopped worker when it is offline", () => {
    const status = describeSystemStatus({ ...BASE, worker: { ...ONLINE, online: false } });

    expect(status.label).toBe("Worker parado");
  });

  test("reports Docker as unavailable", () => {
    const status = describeSystemStatus({ ...BASE, worker: { ...ONLINE, dockerAvailable: false } });

    expect(status).toEqual({ label: "Docker indisponível", tone: "down" });
  });

  test.each([
    [1, "1 deploy em andamento"],
    [3, "3 deploys em andamento"],
  ])("counts %p deploys in progress", (activeDeployments, label) => {
    const status = describeSystemStatus({ ...BASE, activeDeployments });

    expect(status).toEqual({ label, tone: "busy" });
  });

  test("says the system is operating when nothing is running", () => {
    const status = describeSystemStatus(BASE);

    expect(status).toEqual({ label: "Sistema operando", tone: "ok" });
  });
});
