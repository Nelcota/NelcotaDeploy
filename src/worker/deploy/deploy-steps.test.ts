import { describe, expect, test } from "bun:test";

import { withPortVariable } from "./deploy-steps";

describe("withPortVariable", () => {
  test("tells a Railpack image which port to listen on", () => {
    const values = withPortVariable({ API_URL: "x" }, { builder: "railpack", internalPort: 3000 });

    expect(values).toEqual({ API_URL: "x", PORT: "3000" });
  });

  test("keeps a PORT the project defines", () => {
    const values = withPortVariable({ PORT: "8080" }, { builder: "railpack", internalPort: 3000 });

    expect(values).toEqual({ PORT: "8080" });
  });

  test("leaves images built from a Dockerfile alone", () => {
    const values = withPortVariable({}, { builder: "dockerfile", internalPort: 3000 });

    expect(values).toEqual({});
  });
});
