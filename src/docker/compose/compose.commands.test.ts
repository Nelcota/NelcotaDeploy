import { describe, expect, test } from "bun:test";

import { InvalidDockerArgumentError } from "../docker.errors";
import {
  composeConfigArgs,
  composeContainerNameFor,
  composeProjectNameFor,
  composeUpArgs,
} from "./compose.commands";

const PROJECT = {
  projectName: "nelcota-0190f6a1",
  files: ["/data/workspaces/api-1/nelcota-compose.json"],
  directory: "/data/workspaces/api-1/repository",
};

describe("composeProjectNameFor", () => {
  test("derives a lowercase name from the project id", () => {
    expect(composeProjectNameFor("0190F6A1-B2C3-7D4E-8F9A-0B1C2D3E4F5A")).toBe(
      "nelcota-0190f6a1b2c37d4e8f9a0b1c2d3e4f5a",
    );
  });

  test("throws InvalidDockerArgumentError for an id that could inject options", () => {
    expect(() => composeProjectNameFor("--file=/etc/x")).toThrow(InvalidDockerArgumentError);
  });
});

describe("composeContainerNameFor", () => {
  test("names the first container of a service as Compose does", () => {
    expect(composeContainerNameFor("nelcota-0190", "web")).toBe("nelcota-0190-web-1");
  });

  test("throws InvalidDockerArgumentError for a service with uppercase letters", () => {
    expect(() => composeContainerNameFor("nelcota-0190", "Web")).toThrow(
      InvalidDockerArgumentError,
    );
  });
});

describe("compose commands", () => {
  test("renders the model without reading env files", () => {
    expect(composeConfigArgs(PROJECT)).toEqual([
      "compose",
      "--project-name",
      PROJECT.projectName,
      "--project-directory",
      PROJECT.directory,
      "--env-file",
      "/dev/null",
      "--file",
      PROJECT.files[0] ?? "",
      "config",
      "--format",
      "json",
      "--no-env-resolution",
    ]);
  });

  test("builds, starts and removes services the file dropped", () => {
    expect(composeUpArgs(PROJECT).slice(-4)).toEqual([
      "up",
      "--detach",
      "--build",
      "--remove-orphans",
    ]);
  });

  test("throws InvalidDockerArgumentError without a file", () => {
    expect(() => composeUpArgs({ ...PROJECT, files: [] })).toThrow(InvalidDockerArgumentError);
  });

  test("throws InvalidDockerArgumentError for a relative path", () => {
    expect(() => composeUpArgs({ ...PROJECT, directory: "--privileged" })).toThrow(
      InvalidDockerArgumentError,
    );
  });
});
