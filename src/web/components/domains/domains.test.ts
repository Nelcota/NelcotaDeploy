import { describe, expect, test } from "bun:test";

import { dnsRecordType, domainUrl } from "./domains";

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
