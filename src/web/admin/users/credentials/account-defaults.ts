import { newUserSchema } from "@/shared/schemas/user.schema";

const GENERATED_PASSWORD_BYTES = 18;
const MAX_ACCOUNT_INPUT_LENGTH = 512;

/** Generates a new 144-bit password without storing or transmitting it before submission. */
export function generateAccountPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(GENERATED_PASSWORD_BYTES));
  return bytes.toBase64({ alphabet: "base64url", omitPadding: true });
}

/** Uses an explicitly supplied display name; a bare address never guesses someone's identity. */
export function parseAccountAddress(
  value: string,
): { readonly email: string; readonly name: string | null } | null {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > MAX_ACCOUNT_INPUT_LENGTH || /[\r\n\0]/.test(trimmed)) {
    return null;
  }
  const display = /^(?:"([^"<>]+)"|([^"<>]+))\s*<([^<>]+)>$/.exec(trimmed);
  const email = newUserSchema.shape.email.safeParse((display?.[3] ?? trimmed).trim());
  if (email.success === false) {
    return null;
  }
  if (display == null) {
    return { email: email.data, name: null };
  }
  const name = newUserSchema.shape.name.safeParse(
    (display[1] ?? display[2] ?? "").normalize("NFC").trim(),
  );
  return name.success ? { email: email.data, name: name.data } : null;
}

export type AccountCredentials = {
  readonly name: string;
  readonly email: string;
  readonly password: string;
};
