import { expect, test } from "bun:test";

import { firstPublicationConfirmation } from "./first-publication-confirmation";

test("shows confirmation only for the current first publication", () => {
  const details = { liveDeployment: { id: "first", isFirstPublication: true } };

  expect(firstPublicationConfirmation(details)).toBe(true);
  expect(firstPublicationConfirmation(details, "first")).toBe(true);
  expect(firstPublicationConfirmation(details, "preview")).toBe(false);
  expect(firstPublicationConfirmation({ liveDeployment: null })).toBe(false);
  expect(
    firstPublicationConfirmation({ liveDeployment: { id: "second", isFirstPublication: false } }),
  ).toBe(false);
  expect(firstPublicationConfirmation(undefined)).toBe(false);
});
