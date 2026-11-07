import { describe, expect, test } from "bun:test";

import { ForbiddenError, UserOperationError } from "@/auth";
import {
  DatabaseVariableConflictError,
  DatabaseServerChangedError,
  ProjectHasDatabasesError,
} from "@/databases";
import { CloudflareApiError, DnsConfigurationError } from "@/domains";
import { ProjectNotFoundError } from "@/projects";
import { TaskReviewChangedError } from "@/tasks";
import { ProjectHasVolumesError, VolumeServerChangedError } from "@/volumes";

import { PublicError, toPublicError } from "./public-error";

describe("toPublicError", () => {
  test("requests new reviews when task configuration or volume destination changes", () => {
    expect(toPublicError(new TaskReviewChangedError("private-task-id"))?.message).toContain(
      "A task mudou",
    );
    expect(toPublicError(new VolumeServerChangedError("private-project-id"))?.message).toContain(
      "O servidor do projeto mudou",
    );
  });
  test("requests a new review after the database target server changes", () => {
    expect(toPublicError(new DatabaseServerChangedError("private-project-id"))?.message).toBe(
      "O servidor do projeto mudou. Volte e revise a criação do banco no servidor atual.",
    );
  });
  test("explains Cloudflare access failures without provider internals", () => {
    const error = toPublicError(new CloudflareApiError(403));
    expect(error?.message).toContain("Cloudflare");
    expect(error?.message).not.toContain("403");
  });

  test.each(["origin-not-found", "review-changed", "invalid-review", "zone-not-found"] as const)(
    "translates DNS review reason %s",
    (reason) => {
      const error = toPublicError(new DnsConfigurationError(reason));
      expect(error).toBeInstanceOf(PublicError);
      expect(error?.message).not.toContain(reason);
    },
  );
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
