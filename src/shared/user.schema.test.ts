import { describe, expect, test } from "bun:test";

import { newUserSchema, PASSWORD_MIN_LENGTH, passwordSchema } from "./user.schema";

const VALID_USER = {
  name: "Ana Souza",
  email: "Ana@Example.com",
  role: "developer",
  password: "a".repeat(PASSWORD_MIN_LENGTH),
};

describe("newUserSchema", () => {
  test("accepts a valid user and normalizes the e-mail", () => {
    const result = newUserSchema.parse(VALID_USER);

    expect(result.email).toBe("ana@example.com");
  });

  test.each([
    ["name", { name: "   " }, "Informe o nome"],
    ["email", { email: "ana" }, "E-mail inválido"],
    [
      "password",
      { password: "curta" },
      `A senha precisa ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres`,
    ],
  ])("rejects an invalid %s with a message in Portuguese", (field, patch, message) => {
    const result = newUserSchema.safeParse({ ...VALID_USER, ...patch });

    expect(result.success).toBe(false);
    expect(result.error?.issues.find((issue) => issue.path[0] === field)?.message).toBe(message);
  });

  test("rejects an unknown role", () => {
    const result = newUserSchema.safeParse({ ...VALID_USER, role: "owner" });

    expect(result.success).toBe(false);
  });
});

describe("passwordSchema", () => {
  test("accepts a password exactly at the minimum length", () => {
    const result = passwordSchema.safeParse("a".repeat(PASSWORD_MIN_LENGTH));

    expect(result.success).toBe(true);
  });

  test("rejects an empty password", () => {
    const result = passwordSchema.safeParse("");

    expect(result.success).toBe(false);
  });

  test("rejects a password above 256 characters", () => {
    const result = passwordSchema.safeParse("a".repeat(257));

    expect(result.success).toBe(false);
  });
});
