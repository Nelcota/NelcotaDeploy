import { expect, test } from "bun:test";

import { getConfig } from "@/config";

import { offsiteStoreFromConfig } from "./offsite-backup";

function listingPage(key: string, truncated: boolean, nextToken?: string): Response {
  const token =
    nextToken == null ? "" : `<NextContinuationToken>${nextToken}</NextContinuationToken>`;
  return new Response(
    `<ListBucketResult><IsTruncated>${truncated}</IsTruncated><Contents><Key>${key}</Key><Size>1</Size></Contents>${token}</ListBucketResult>`,
    { headers: { "Content-Type": "application/xml" } },
  );
}

async function listingStore(fetch: (request: Request) => Response) {
  const server = Bun.serve({ port: 0, fetch });
  const store = offsiteStoreFromConfig({
    ...getConfig(),
    BACKUP_S3_BUCKET: "test",
    BACKUP_S3_ENDPOINT: server.url.href,
    BACKUP_S3_REGION: "us-east-1",
    BACKUP_S3_ACCESS_KEY_ID: "test",
    BACKUP_S3_SECRET_ACCESS_KEY: "test",
  });
  if (store == null) {
    await server.stop(true);
    throw new Error("S3 test store did not initialize");
  }

  return { store, [Symbol.asyncDispose]: async () => await server.stop(true) };
}

test("lists keys across pages using the bucket continuation token", async () => {
  const tokens: (string | null)[] = [];
  await using fixture = await listingStore((request) => {
    const token = new URL(request.url).searchParams.get("continuation-token");
    tokens.push(token);
    return token == null
      ? listingPage("backups/first", true, "second")
      : listingPage("backups/second", false);
  });

  const keys = await fixture.store.list("backups/");

  expect(keys).toEqual(["backups/first", "backups/second"]);
  expect(tokens).toEqual([null, "second"]);
});

test.each([
  { scenario: "missing", token: undefined, expectedPages: 1 },
  { scenario: "repeated", token: "repeat", expectedPages: 2 },
])(
  "rejects a $scenario continuation token instead of returning a partial list",
  async ({ token, expectedPages }) => {
    let requests = 0;
    await using fixture = await listingStore(() => {
      requests += 1;
      if (requests > expectedPages) {
        return listingPage("backups/unexpected", false);
      }

      return listingPage("backups/first", true, token);
    });

    const result = await fixture.store.list("backups/").catch((error: unknown) => error);

    expect(result).toHaveProperty(
      "message",
      "The backup bucket returned an invalid continuation token",
    );
    expect(requests).toBe(expectedPages);
  },
);
