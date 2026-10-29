import { describe, expect, test } from "bun:test";

import { dnsRecordType, dnsTag, domainUrl, needsDnsHelp } from "./domains";

describe("domainUrl", () => {
  test("uses https when HTTPS is enabled", () => {
    const url = domainUrl({ hostname: "app.example.com", httpsEnabled: true });

    expect(url).toBe("https://app.example.com");
  });

  test("uses http when HTTPS is disabled", () => {
    const url = domainUrl({ hostname: "app.example.com", httpsEnabled: false });

    expect(url).toBe("http://app.example.com");
  });
});

describe("dnsRecordType", () => {
  test("asks for a CNAME when the project has an automatic hostname", () => {
    const type = dnsRecordType("app.base.example.com");

    expect(type).toBe("CNAME");
  });

  test("asks for an A record without an automatic hostname", () => {
    const type = dnsRecordType(null);

    expect(type).toBe("A");
  });
});

describe("dnsTag", () => {
  test("confirms a domain that points at the project's server", () => {
    expect(dnsTag({ status: "ok", resolved: ["1.2.3.4"] })?.tone).toBe("success");
  });

  test("names the addresses of a domain that points elsewhere", () => {
    const tag = dnsTag({ status: "elsewhere", resolved: ["104.16.0.1"] });

    expect(tag?.tone).toBe("warning");
    expect(tag?.detail).toContain("104.16.0.1");
  });

  test("warns about a domain without a record", () => {
    expect(dnsTag({ status: "missing", resolved: [] })?.label).toBe("Sem DNS");
  });

  test.each([[undefined], [{ status: "unknown", resolved: [] } as const]])(
    "shows nothing for %p",
    (dns) => {
      expect(dnsTag(dns)).toBeNull();
    },
  );
});

describe("needsDnsHelp", () => {
  const custom = { hostname: "app.example.com", automatic: false };
  const automatic = { hostname: "api.apps.example.com", automatic: true };

  test("explains DNS while there is no custom domain", () => {
    expect(needsDnsHelp([automatic], new Map())).toBe(true);
  });

  test("explains DNS while a custom domain does not point at the server", () => {
    const dns = new Map([["app.example.com", { status: "missing" as const }]]);

    expect(needsDnsHelp([automatic, custom], dns)).toBe(true);
  });

  test("explains DNS while the check has not answered yet", () => {
    expect(needsDnsHelp([custom], new Map())).toBe(true);
  });

  test("hides the explanation once every custom domain points at the server", () => {
    const dns = new Map([["app.example.com", { status: "ok" as const }]]);

    expect(needsDnsHelp([automatic, custom], dns)).toBe(false);
  });
});
