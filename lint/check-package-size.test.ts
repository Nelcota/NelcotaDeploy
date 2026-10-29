import { describe, expect, test } from "bun:test";

import { findOversizedPackages } from "./check-package-size.ts";

function sourceFiles(directory: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${directory}/file-${index}.ts`);
}

describe("findOversizedPackages", () => {
  test("returns nothing when every folder is at the limit", () => {
    const filePaths = sourceFiles("src/orders", 3);

    const oversized = findOversizedPackages(filePaths, 3);

    expect(oversized).toEqual([]);
  });

  test("reports a folder with more source files than the limit", () => {
    const filePaths = sourceFiles("src/orders", 4);

    const oversized = findOversizedPackages(filePaths, 3);

    expect(oversized).toEqual([{ directory: "src/orders", fileCount: 4 }]);
  });
});

describe("findOversizedPackages file types", () => {
  test("ignores test files when counting", () => {
    const filePaths = [...sourceFiles("src/orders", 3), "src/orders/order.service.test.ts"];

    const oversized = findOversizedPackages(filePaths, 3);

    expect(oversized).toEqual([]);
  });

  test("ignores the shadcn/ui generated folder", () => {
    const filePaths = sourceFiles("src/web/components/ui", 4);

    const oversized = findOversizedPackages(filePaths, 3);

    expect(oversized).toEqual([]);
  });

  test("counts tsx files as source files", () => {
    const filePaths = [...sourceFiles("src/orders", 3), "src/orders/order-card.tsx"];

    const oversized = findOversizedPackages(filePaths, 3);

    expect(oversized).toEqual([{ directory: "src/orders", fileCount: 4 }]);
  });

  test("ignores spec and tsx test files when counting", () => {
    const filePaths = [
      ...sourceFiles("src/orders", 3),
      "src/orders/order.spec.ts",
      "src/orders/order-card.test.tsx",
    ];

    const oversized = findOversizedPackages(filePaths, 3);

    expect(oversized).toEqual([]);
  });
});

describe("findOversizedPackages folders", () => {
  test("counts sub-packages separately from their parent", () => {
    const filePaths = [...sourceFiles("src/orders", 3), ...sourceFiles("src/orders/payment", 3)];

    const oversized = findOversizedPackages(filePaths, 3);

    expect(oversized).toEqual([]);
  });

  test("returns oversized folders sorted by path", () => {
    const filePaths = [...sourceFiles("src/orders", 2), ...sourceFiles("src/customers", 2)];

    const oversized = findOversizedPackages(filePaths, 1);

    expect(oversized.map((entry) => entry.directory)).toEqual(["src/customers", "src/orders"]);
  });
});

describe("findOversizedPackages edge cases", () => {
  test("returns nothing when there are no files", () => {
    const oversized = findOversizedPackages([], 3);

    expect(oversized).toEqual([]);
  });

  test.each([0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "throws RangeError when maxFiles is %p",
    (maxFiles) => {
      const action = () => findOversizedPackages([], maxFiles);

      expect(action).toThrow(RangeError);
    },
  );
});

describe("findOversizedPackages on Windows paths", () => {
  test("reads backslash separators like forward slashes", () => {
    const filePaths = Array.from({ length: 4 }, (_, index) => `src\\orders\\file-${index}.ts`);

    const oversized = findOversizedPackages(filePaths, 3);

    expect(oversized).toEqual([{ directory: "src/orders", fileCount: 4 }]);
  });

  test("still ignores the shadcn/ui folder with backslash separators", () => {
    const filePaths = Array.from(
      { length: 4 },
      (_, index) => `src\\web\\components\\ui\\file-${index}.tsx`,
    );

    const oversized = findOversizedPackages(filePaths, 3);

    expect(oversized).toEqual([]);
  });
});
