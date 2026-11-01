import { describe, expect, test } from "bun:test";

import { ForbiddenError, UserOperationError } from "@/auth";
import { DatabaseVariableConflictError, ProjectHasDatabasesError } from "@/databases";
import { ProjectNotFoundError } from "@/projects";
import { ProjectHasVolumesError } from "@/volumes";

import { PublicError, toPublicError } from "./public-error";

describe("toPublicError", () => {
  test("translates known domain errors to Portuguese", () => {
    expect(toPublicError(new ProjectNotFoundError("x"))?.message).toBe("Projeto não encontrado.");
  });

  test("explains why a project with volumes cannot move", () => {
    expect(toPublicError(new ProjectHasVolumesError("x"))?.message).toContain(
      "não podem mudar de servidor",
    );
  });

  test("explains why a project with databases cannot move", () => {
    expect(toPublicError(new ProjectHasDatabasesError("x"))?.message).toContain(
      "não podem mudar de servidor",
    );
  });

  test("tells the user to pick another variable name for a database", () => {
    expect(toPublicError(new DatabaseVariableConflictError("DATABASE_URL"))?.message).toContain(
      "já tem uma variável com esse nome",
    );
  });

  test("does not leak the permission name of a forbidden action", () => {
    expect(toPublicError(new ForbiddenError("user:manage"))?.message).toBe(
      "Você não tem permissão para esta ação.",
    );
  });

  test("translates the last-admin rule", () => {
    const error = new UserOperationError("At least one active admin must remain");

    expect(toPublicError(error)?.message).toBe(
      "É preciso manter pelo menos um administrador ativo.",
    );
  });

  test("keeps public errors unchanged", () => {
    const error = new PublicError("Mensagem");

    expect(toPublicError(error)).toBe(error);
  });

  test("uses the first validation issue message", () => {
    expect(toPublicError({ issues: [{ message: "Campo obrigatório" }] })?.message).toBe(
      "Dados inválidos: Campo obrigatório",
    );
  });

  test("returns null for unknown errors so they are logged and hidden", () => {
    expect(toPublicError(new Error("SQLITE_BUSY: database is locked at /data/x.db"))).toBeNull();
  });
});
