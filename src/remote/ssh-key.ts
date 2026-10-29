import { utils } from "ssh2";

/** An SSH key pair in OpenSSH text format. */
export type SshKeyPair = { readonly publicKey: string; readonly privateKey: string };

/**
 * Generates the Ed25519 key pair the panel uses to log in to its servers.
 *
 * @returns Public key line (for `authorized_keys`) and private key.
 */
export function generateSshKeyPair(): SshKeyPair {
  const pair = utils.generateKeyPairSync("ed25519", { comment: "nelcota-panel" });
  return { publicKey: pair.public.trim(), privateKey: pair.private };
}
