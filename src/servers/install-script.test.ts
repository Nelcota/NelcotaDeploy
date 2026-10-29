import { describe, expect, test } from "bun:test";

import { generateSshKeyPair } from "@/remote";

import { buildInstallCommand } from "./install-script";
import { InvalidInstallInputError } from "./server.errors";

const { publicKey } = generateSshKeyPair();

describe("buildInstallCommand", () => {
  test("produces a command a POSIX shell accepts", async () => {
    const command = buildInstallCommand(publicKey, "nelcota");
    const child = Bun.spawn(["sh", "-n"], { stdin: new Blob([command]), stderr: "pipe" });

    const exitCode = await child.exited;

    expect(exitCode).toBe(0);
  });

  test("passes the key and username as arguments of the script", () => {
    const command = buildInstallCommand(publicKey, "deploy");

    expect(command.split("\n")[0]).toContain(`'${publicKey}' 'deploy'`);
    expect(command.trimEnd().endsWith("NELCOTA_INSTALL")).toBe(true);
  });

  test("throws InvalidInstallInputError for a key that could break out of its quotes", () => {
    const build = () => buildInstallCommand("ssh-ed25519 AAAA' ; rm -rf / '", "nelcota");

    expect(build).toThrow(InvalidInstallInputError);
  });

  test("throws InvalidInstallInputError for a malformed username", () => {
    expect(() => buildInstallCommand(publicKey, "root;id")).toThrow(InvalidInstallInputError);
  });
});
