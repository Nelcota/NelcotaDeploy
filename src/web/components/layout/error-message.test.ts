import { describe, expect, test } from "bun:test";

import { toUserMessage } from "@/web/components/layout/error-message";

const FALLBACK = "Não foi possível concluir a ação.";

describe("toUserMessage", () => {
  test("hides the browser's network error behind a Portuguese message", () => {
    const message = toUserMessage(new TypeError("Failed to fetch"), FALLBACK);

    expect(message).toBe("Sem conexão com o servidor. Verifique a rede e tente novamente.");
  });

  test("keeps the message sent by the server", () => {
    const message = toUserMessage(new Error("Projeto não encontrado."), FALLBACK);

    expect(message).toBe("Projeto não encontrado.");
  });

  test("uses the fallback for an error with a blank message", () => {
    const message = toUserMessage(new Error("   "), FALLBACK);

    expect(message).toBe(FALLBACK);
  });

  test("uses the fallback for something that is not an error", () => {
    const message = toUserMessage("boom", FALLBACK);

    expect(message).toBe(FALLBACK);
  });

  test("uses the fallback for null", () => {
    const message = toUserMessage(null, FALLBACK);

    expect(message).toBe(FALLBACK);
  });
});
