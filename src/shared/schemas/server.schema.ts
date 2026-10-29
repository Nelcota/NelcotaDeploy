import { z } from "zod";

import { isValidHostname } from "./domain.schema";

const MAX_NAME_LENGTH = 60;
const MAX_PORT = 65_535;
const DEFAULT_SSH_PORT = 22;
/** Account the install script creates on a new server. */
export const DEFAULT_SERVER_USERNAME = "nelcota";
const USERNAME_PATTERN = /^[a-z_][a-z0-9_-]{0,31}$/;

/**
 * Tells whether a value is an IPv4 or IPv6 address, or a fully qualified hostname.
 *
 * @param host - Lowercase value without scheme or port.
 * @returns True when the panel can connect to it.
 */
function isValidServerHost(host: string): boolean {
  return (
    z.ipv4().safeParse(host).success || z.ipv6().safeParse(host).success || isValidHostname(host)
  );
}

export const serverInputSchema = z.object({
  name: z
    .string()
    .trim()
    .normalize("NFC")
    .min(1, "Informe um nome")
    .max(MAX_NAME_LENGTH, `Use até ${MAX_NAME_LENGTH} caracteres`),
  host: z
    .string()
    .trim()
    .toLowerCase()
    .refine(isValidServerHost, { message: "Informe um IP ou domínio válido, como 203.0.113.10" }),
  port: z
    .number()
    .int()
    .min(1, "Porta inválida")
    .max(MAX_PORT, "Porta inválida")
    .default(DEFAULT_SSH_PORT),
  username: z
    .string()
    .trim()
    .regex(USERNAME_PATTERN, "Use letras minúsculas, números, _ ou -")
    .default(DEFAULT_SERVER_USERNAME),
});

export type ServerInput = z.infer<typeof serverInputSchema>;
