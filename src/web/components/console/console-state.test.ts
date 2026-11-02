import { describe, expect, test } from "bun:test";

import { failureText } from "./console-state";

describe("failureText", () => {
  test("adds nothing to a command that exited with a code, which is already shown", () => {
    expect(
      failureText({ status: "failed", exitCode: 1, errorMessage: "Command exited with code 1" }),
    ).toBeNull();
  });

  test("explains a timeout without promising that the container process stopped", () => {
    expect(
      failureText({
        status: "failed",
        exitCode: 137,
        errorMessage: "Stopped after its 60s timeout",
      }),
    ).toBe(
      "O painel parou de acompanhar após 60 segundos. O comando pode continuar no contêiner. Confira o resultado antes de repetir.",
    );
  });

  test.each([
    "Interrupted because the worker is shutting down",
    "The worker stopped while the command was pending or running; its outcome is unknown",
  ])("requires checking the outcome before retrying after %s", (errorMessage) => {
    expect(failureText({ status: "failed", exitCode: null, errorMessage })).toBe(
      "O worker reiniciou. Confira o resultado no aplicativo antes de repetir o comando.",
    );
  });

  test("explains a project without a live container", () => {
    expect(
      failureText({
        status: "failed",
        exitCode: null,
        errorMessage: "The project has no live container",
      }),
    ).toBe("O projeto não tem contêiner no ar.");
  });

  test("never shows an unknown internal message, only a generic one", () => {
    expect(
      failureText({ status: "failed", exitCode: null, errorMessage: "docker: socket closed" }),
    ).toBe("Não foi possível rodar o comando no contêiner.");
  });

  test("says nothing about a command that succeeded", () => {
    expect(failureText({ status: "succeeded", exitCode: 0, errorMessage: null })).toBeNull();
  });
});
