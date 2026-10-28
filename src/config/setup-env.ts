import { chmod, writeFile } from "node:fs/promises";

/**
 * Creates `.env` from `.env.example`, generating every secret, so a fresh checkout runs
 * without inventing keys by hand. An existing `.env` is never overwritten.
 */
const ENV_FILE = ".env";
const EXAMPLE_FILE = ".env.example";
const PRIVATE_FILE_MODE = 0o600;
const SECRET_BYTES = 32;

function randomBase64(bytes: number): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64");
}

const GENERATED: Readonly<Record<string, () => string>> = {
  BETTER_AUTH_SECRET: () => randomBase64(SECRET_BYTES),
  NELCOTA_ENCRYPTION_KEY: () => randomBase64(SECRET_BYTES),
  GITHUB_WEBHOOK_SECRET: () =>
    Buffer.from(crypto.getRandomValues(new Uint8Array(SECRET_BYTES))).toString("hex"),
};

if (await Bun.file(ENV_FILE).exists()) {
  process.stdout.write(".env already exists; nothing changed.\n");
  process.exit(0);
}

const example = await Bun.file(EXAMPLE_FILE).text();
const lines = example.split("\n").map((line) => {
  const [key] = line.split("=", 1);
  const generate = key == null ? undefined : GENERATED[key];
  return generate == null ? line : `${key}=${generate()}`;
});
await writeFile(ENV_FILE, lines.join("\n"));
await chmod(ENV_FILE, PRIVATE_FILE_MODE);
process.stdout.write(
  "Created .env with freshly generated secrets. Keep NELCOTA_ENCRYPTION_KEY safe: losing it makes stored secrets unreadable.\n",
);
