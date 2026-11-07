import { z } from "zod";

export const cloudflareTokenSchema = z
  .string()
  .trim()
  .min(20, "Informe um API Token da Cloudflare")
  .max(512, "Token muito longo")
  .regex(/^[A-Za-z0-9._-]+$/, "Token inválido");

export const dnsConfirmationSchema = z
  .string()
  .min(1, "Revise as alterações antes de confirmar")
  .max(100_000, "Revisão muito longa");
