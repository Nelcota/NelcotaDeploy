import { describe, expect, test } from "bun:test";

import { RAILPACK_VERSION } from "@/docker";
import { generateSshKeyPair } from "@/remote";

import { buildInstallCommand } from "./install-script";
import { InvalidInstallInputError } from "./server.errors";

const { publicKey } = generateSshKeyPair();
const SHELL = Bun.which("sh", { PATH: process.env["PATH"] ?? "" }) ?? "sh";

describe("buildInstallCommand", () => {
  test("produces a command a POSIX shell accepts", async () => {
    const command = buildInstallCommand(publicKey, "nelcota");
    const child = Bun.spawn([SHELL, "-n"], { stdin: new Blob([command]), stderr: "pipe" });

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

describe("buildInstallCommand Railpack", () => {
  test("installs the Railpack version the worker builds with", () => {
    const command = buildInstallCommand(publicKey, "nelcota");

    expect(command).toContain(`/v${RAILPACK_VERSION}/railpack-v${RAILPACK_VERSION}-`);
  });

  test("checks the archive against its checksum before installing it", () => {
    const command = buildInstallCommand(publicKey, "nelcota");

    expect(command.indexOf("sha256sum -c")).toBeLessThan(command.indexOf("install -m 755"));
  });

  test("pins the same Railpack version in the worker image", async () => {
    const dockerfile = await Bun.file(new URL("../../Dockerfile", import.meta.url)).text();

    expect(dockerfile).toContain(`/v${RAILPACK_VERSION}/railpack-v${RAILPACK_VERSION}-`);
  });
});
