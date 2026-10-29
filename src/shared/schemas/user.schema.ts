import { z } from "zod";

import { ROLES } from "../roles";

/** Minimum password length enforced for every account. */
export const PASSWORD_MIN_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 256;
const MAX_NAME_LENGTH = 80;

/** A new password, as typed by an administrator. */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `A senha precisa ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres`)
  .max(MAX_PASSWORD_LENGTH, `A senha pode ter no máximo ${MAX_PASSWORD_LENGTH} caracteres`);

/** Fields of the "Novo usuário" form, validated in the browser and again on the server. */
export const newUserSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Informe o nome")
    .max(MAX_NAME_LENGTH, `Use no máximo ${MAX_NAME_LENGTH} caracteres`),
  email: z.email("E-mail inválido").trim().toLowerCase(),
  role: z.enum(ROLES),
  password: passwordSchema,
});
