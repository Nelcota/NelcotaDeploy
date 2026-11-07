import { expect, test } from "bun:test";

import { utils } from "ssh2";

import { generateSshKeyPair } from "./ssh-key";

test("generates an Ed25519 private key matching its public key", () => {
  const pair = generateSshKeyPair();

  const parsed = utils.parseKey(pair.privateKey);
  if (parsed instanceof Error) {
    throw new Error("Generated SSH key is not parseable");
  }
  const publicBody = pair.publicKey.split(" ")[1];
  if (publicBody == null || publicBody === "") {
    throw new Error("Generated SSH public key has no body");
  }

  expect(parsed.type).toBe("ssh-ed25519");
  expect(parsed.getPublicSSH().toString("base64")).toBe(publicBody);
});

test("retries an invalid library result before returning a key pair", () => {
  const valid = generateSshKeyPair();
  let attempts = 0;

  const pair = generateSshKeyPair(() => {
    attempts++;
    return attempts === 1
      ? { public: "invalid", private: "invalid" }
      : { public: valid.publicKey, private: valid.privateKey };
  });

  expect(attempts).toBe(2);
  expect(pair).toEqual(valid);
});

test("fails after a bounded number of invalid library results", () => {
  let attempts = 0;
  const generate = () => {
    attempts++;
    return { public: "invalid", private: "invalid" };
  };

  expect(() => generateSshKeyPair(generate)).toThrow(
    "SSH key generation failed after 3 invalid pairs",
  );
  expect(attempts).toBe(3);
});
