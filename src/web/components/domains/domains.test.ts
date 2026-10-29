import { describe, expect, test } from "bun:test";

import { dnsRecordType, dnsTag, domainUrl } from "./domains";

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
