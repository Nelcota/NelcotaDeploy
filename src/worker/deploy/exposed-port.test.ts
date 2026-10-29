import { describe, expect, test } from "bun:test";

import { detectExposedPort } from "./exposed-port";

describe("detectExposedPort", () => {
  test("reads the exposed port", () => {
    expect(detectExposedPort("FROM node:24\nEXPOSE 8080\nCMD node server.js")).toBe(8080);
  });

  test("takes the last EXPOSE, which belongs to the final stage", () => {
    const dockerfile = "FROM node AS build\nEXPOSE 5173\nFROM nginx\nexpose 80/tcp 443\n";

    expect(detectExposedPort(dockerfile)).toBe(80);
  });

  test("skips variables and keeps the last literal port", () => {
    expect(detectExposedPort("EXPOSE 3000\nEXPOSE $PORT\n")).toBe(3000);
  });

  test.each([[""], ["FROM scratch"], ["EXPOSE 0"], ["EXPOSE 70000"], ["# EXPOSE 8080"]])(
    "returns null for %p",
    (dockerfile) => {
      expect(detectExposedPort(dockerfile)).toBeNull();
    },
  );
});
