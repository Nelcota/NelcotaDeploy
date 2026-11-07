import { expect, test } from "bun:test";

import { parseServerConnection, suggestServerName } from "./server-connection";

test.each([
  ["  VPS.Example.com  ", { host: "vps.example.com", username: "nelcota", port: 22 }],
  ["203.0.113.10:2222", { host: "203.0.113.10", username: "nelcota", port: 2222 }],
  ["deploy@vps.example.com", { host: "vps.example.com", username: "deploy", port: 22 }],
  [
    "ssh://deploy@vps.example.com:2200",
    { host: "vps.example.com", username: "deploy", port: 2200 },
  ],
  [
    "ssh -p 2200 deploy@vps.example.com",
    { host: "vps.example.com", username: "deploy", port: 2200 },
  ],
  [
    "ssh -p2200 -l deploy vps.example.com",
    { host: "vps.example.com", username: "deploy", port: 2200 },
  ],
  [
    "ssh -l deploy -p 2200 'vps.example.com'",
    { host: "vps.example.com", username: "deploy", port: 2200 },
  ],
  ["2001:db8::1", { host: "2001:db8::1", username: "nelcota", port: 22 }],
  ["ssh://deploy@[2001:db8::1]:2200", { host: "2001:db8::1", username: "deploy", port: 2200 }],
] as const)("detects the connection from %s", (value, expected) => {
  expect(parseServerConnection(value)).toEqual(expected);
});

test.each([
  "",
  " ",
  "ssh",
  "ssh -p",
  "ssh -p 0 vps.example.com",
  "ssh -p 65536 vps.example.com",
  "ssh -p NaN vps.example.com",
  "ssh -p 22 -p 23 vps.example.com",
  "ssh -l other deploy@vps.example.com",
  "ssh -i key vps.example.com",
  "ssh -o ProxyCommand=id vps.example.com",
  "ssh vps.example.com reboot",
  "ssh vps.example.com;id",
  "ssh 'unterminated",
  "ssh://deploy:password@vps.example.com",
  "ssh://vps.example.com/path",
  "https://vps.example.com",
  "ssh://vps.example.com?key=value",
  "ssh://vps.example.com#fragment",
  "vps.example.com\nreboot",
  "x".repeat(1025),
])("rejects unsupported or invalid connection %s", (value) => {
  expect(parseServerConnection(value)).toBeNull();
});

test("derives available names for hosts and IPs without changing existing names", () => {
  expect(suggestServerName("vps.example.com", ["VPS", "vps-2"])).toBe("vps-3");
  expect(suggestServerName("203.0.113.10", [])).toBe("server-203-0-113-10");
  expect(suggestServerName("2001:db8::1", [])).toBe("server-2001-db8--1");
  const host = `${"a".repeat(60)}.example.com`;
  expect(suggestServerName(host, ["a".repeat(60)])).toHaveLength(60);
});
