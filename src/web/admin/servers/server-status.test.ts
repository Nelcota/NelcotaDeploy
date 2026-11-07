import { describe, expect, test } from "bun:test";

import {
  describeLastCleanup,
  describeServerProblem,
  hasServerInProgress,
  serverStatusPill,
} from "./server-status";

describe("describeServerProblem", () => {
  test.each([
    [
      "SSH connection to 1.2.3.4 failed: All configured authentication methods failed",
      "O painel ainda não tem acesso. Rode o comando de instalação no servidor.",
    ],
    [
      "SSH connection to 1.2.3.4 failed: connect ECONNREFUSED 1.2.3.4:22",
      "Não foi possível conectar. Confira o IP, a porta SSH e o firewall.",
    ],
    [
      "Host key of 1.2.3.4 changed: expected SHA256:a, received SHA256:b. Remove…",
      "A chave SSH do servidor mudou. Se ele foi reinstalado, remova e adicione de novo.",
    ],
  ])("translates %p", (message, expected) => {
    expect(describeServerProblem(message)).toBe(expected);
  });

  test("never shows an unknown internal message", () => {
    expect(describeServerProblem("docker run proxy failed: no space left")).toBe(
      "Não foi possível preparar o servidor. Veja os logs do worker.",
    );
  });

  test.each([[null], [""], ["  "]])("returns null for %p", (message) => {
    expect(describeServerProblem(message)).toBeNull();
  });
});

describe("serverStatusPill", () => {
  test("asks for the install command while a remote server is pending", () => {
    expect(serverStatusPill({ status: "pending", statusMessage: null, kind: "ssh" }).label).toBe(
      "Aguardando instalação",
    );
  });

  test("marks the panel's own host as an error when it is unreachable", () => {
    expect(
      serverStatusPill({ status: "unreachable", statusMessage: null, kind: "local" }).tone,
    ).toBe("danger");
  });
});

describe("hasServerInProgress", () => {
  test("is true while a server is not ready", () => {
    const servers = [
      { status: "ready", statusMessage: null, kind: "local" },
      { status: "pending", statusMessage: null, kind: "ssh" },
    ] as const;

    expect(hasServerInProgress(servers)).toBe(true);
  });

  test("is false when every server is ready", () => {
    expect(hasServerInProgress([{ status: "ready", statusMessage: null, kind: "ssh" }])).toBe(
      false,
    );
  });
});

describe("describeLastCleanup", () => {
  const now = new Date("2026-11-02T12:00:00Z");

  test("says when the cleanup ran and how much it freed", () => {
    const text = describeLastCleanup(
      { lastCleanupAt: "2026-11-02T09:00:00Z", lastCleanupFreedBytes: 1_288_490_189 },
      now,
    );

    expect(text).toContain("há 3 horas");
    expect(text).toContain("liberou 1,2 GB");
  });

  test("says no cleanup ran yet", () => {
    expect(describeLastCleanup({ lastCleanupAt: null, lastCleanupFreedBytes: null }, now)).toBe(
      "Ainda não feita",
    );
  });
});
