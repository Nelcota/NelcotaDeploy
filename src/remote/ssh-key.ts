import { utils } from "ssh2";

/** An SSH key pair in OpenSSH text format. */
export type SshKeyPair = { readonly publicKey: string; readonly privateKey: string };

const MAX_KEY_GENERATION_ATTEMPTS = 3;

function generateOpenSshKey() {
  return utils.generateKeyPairSync("ed25519", { comment: "nelcota-panel" });
}

/**
 * Generates the Ed25519 key pair the panel uses to log in to its servers.
 *
 * @param generate - SSH key generator, replaceable at the crypto library boundary in tests.
 * @returns Public key line (for `authorized_keys`) and a parseable private key.
 * @throws {Error} When the library repeatedly produces an invalid key pair.
 */
export function generateSshKeyPair(generate = generateOpenSshKey): SshKeyPair {
  // ssh2 strips leading zero bytes from Ed25519 public keys when converting DER, which can
  // produce a short public key and an unreadable OpenSSH private key. Never persist that pair.
  for (let attempt = 0; attempt < MAX_KEY_GENERATION_ATTEMPTS; attempt++) {
    const pair = generate();
    const parsed = utils.parseKey(pair.private);
    if (parsed instanceof Error) {
      continue;
    }
    return { publicKey: pair.public.trim(), privateKey: pair.private };
  }
  throw new Error(`SSH key generation failed after ${MAX_KEY_GENERATION_ATTEMPTS} invalid pairs`);
}
