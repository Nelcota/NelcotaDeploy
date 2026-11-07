import { expect, test } from "bun:test";

import { healthCheckPathFromInstruction } from "./dockerfile-healthcheck";
import { parseDockerfileHints } from "./dockerfile-hints";

test.each([
  ["CMD curl -f http://localhost:3000/health || exit 1", "/health"],
  ["--interval=30s --timeout=3s CMD curl -fsS http://127.0.0.1:8000/ready", "/ready"],
  ['CMD ["curl", "--fail", "http://[::1]:3000/healthz"]', "/healthz"],
  ["CMD wget -q -O /dev/null http://0.0.0.0:3000/status", "/status"],
] as const)("extracts a local literal path from %s", (instruction, expected) => {
  expect(healthCheckPathFromInstruction(instruction)).toBe(expected);
});

test.each([
  "NONE",
  "CMD curl -f https://localhost/health",
  "CMD curl http://example.com/health",
  "CMD curl http://user:password@localhost/health",
  "CMD curl http://localhost/health?token=private",
  "CMD curl http://localhost/health#fragment",
  "CMD curl http://localhost:$PORT/health",
  "CMD curl $HEALTH_URL",
  "CMD curl -X POST http://localhost/health",
  "CMD curl -I http://localhost/health",
  "CMD wget --spider http://localhost/health",
  "CMD curl --config config http://localhost/health",
  'CMD curl -H "Authorization: private" http://localhost/health',
  "CMD curl http://localhost/first http://localhost/second",
  "CMD curl http://localhost/health || reboot",
  'CMD ["curl",123]',
  'CMD ["curl", "unterminated]',
  "CMD curl 'unterminated",
  "CMD bun check.ts",
])("does not guess a path from unsupported probe %s", (instruction) => {
  expect(healthCheckPathFromInstruction(instruction)).toBeNull();
});

test("uses only the final stage, named inheritance, and the last health instruction", () => {
  expect(
    parseDockerfileHints(
      "FROM alpine AS base\nHEALTHCHECK CMD curl http://localhost/base\nFROM BASE\nHEALTHCHECK CMD curl http://localhost/final",
    ).healthCheckPath,
  ).toBe("/final");
  expect(
    parseDockerfileHints(
      "FROM alpine AS base\nHEALTHCHECK CMD curl http://localhost/base\nFROM base",
    ).healthCheckPath,
  ).toBe("/base");
  expect(
    parseDockerfileHints(
      "FROM alpine AS build\nHEALTHCHECK CMD curl http://localhost/build\nFROM scratch",
    ).healthCheckPath,
  ).toBeUndefined();
  expect(
    parseDockerfileHints(
      "FROM alpine\nHEALTHCHECK CMD curl http://localhost/health\nHEALTHCHECK NONE",
    ).healthCheckPath,
  ).toBeNull();
});

test("does not read probes from heredocs or unsupported Dockerfile syntax", () => {
  expect(
    parseDockerfileHints("FROM alpine\nRUN <<EOF\nHEALTHCHECK CMD curl http://localhost/fake\nEOF")
      .healthCheckPath,
  ).toBeUndefined();
});
