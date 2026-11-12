import { expect, test } from "bun:test";

import { compile } from "tailwindcss";

import solarIcons from "./solar-icons.plugin";

async function compileSolarUtilities() {
  return await compile('@plugin "./solar-icons.plugin"; @tailwind utilities;', {
    loadModule: () =>
      Promise.resolve({ path: "./solar-icons.plugin", base: ".", module: solarIcons }),
  });
}

test("builds SVG masks only for Solar icons used by the sidebar", async () => {
  const utilities = await compileSolarUtilities();
  const css = utilities.build(["solar-[home-2-bold-duotone]", "solar-[magnifier-linear]"]);

  expect(css).toContain("solar-\\[home-2-bold-duotone\\]");
  expect(css).toContain("solar-\\[magnifier-linear\\]");
  expect(css).toContain("data:image/svg+xml,%3Csvg");
  expect(css).not.toContain("server-bold-duotone");
});

test("skips unknown icon candidates scanned from source files", async () => {
  const utilities = await compileSolarUtilities();

  expect(utilities.build(["solar-[unknown-icon]"])).not.toContain("unknown-icon");
});
