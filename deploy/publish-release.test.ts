import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "node:process";

const ARCHIVE = "nelcota-deploy.tar.gz";
const CHECKSUM = `${ARCHIVE}.sha256`;
const SCRIPT = new URL("publish-release.sh", import.meta.url).pathname;

const GITHUB_FIXTURE = String.raw`#!/bin/sh
set -eu
test "$PWD" = "$RELEASE_FIXTURE"
operation=$2
shift 3
remote=$RELEASE_FIXTURE/assets
case "$operation" in
  view)
    test -f "$RELEASE_FIXTURE/draft" || test -f "$RELEASE_FIXTURE/published" || exit 1
    draft=false
    if test -f "$RELEASE_FIXTURE/draft"; then draft=true; fi
    cd "$remote"
    jq -n --argjson draft "$draft" '{isDraft: $draft, assets: [$ARGS.positional[] | {name: .}]}' --args $(ls)
    ;;
  create) touch "$RELEASE_FIXTURE/draft" ;;
  download)
    if test "$3" = --dir; then cp "$remote/$2" "$4/"; else cp "$remote/$2" "$4"; fi
    ;;
  upload)
    name=$(basename "$1")
    if test "$name" = nelcota-deploy.tar.gz.sha256 && test "$RELEASE_FIXTURE_FAIL_CHECKSUM" = true; then exit 1; fi
    if test -e "$remote/$name"; then
      test "$#" -eq 2 && test "$2" = --clobber || exit 1
    fi
    cp "$1" "$remote/$name"
    ;;
  edit)
    cd "$remote"
    sha256sum -c nelcota-deploy.tar.gz.sha256
    mv "$RELEASE_FIXTURE/draft" "$RELEASE_FIXTURE/published"
    ;;
  *) exit 1 ;;
esac
`;

async function publish(directory: string, failChecksum = false) {
  const child = Bun.spawn(["bash", SCRIPT, "v1.2.3"], {
    cwd: directory,
    env: {
      ...env,
      PATH: `${directory}:${env["PATH"] ?? "/usr/bin:/bin"}`,
      RELEASE_FIXTURE: directory,
      RELEASE_FIXTURE_FAIL_CHECKSUM: String(failChecksum),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  return { exitCode, stderr };
}

test.each(["archive", "checksum"] as const)(
  "publishes a verified pair when only the %s was uploaded",
  async (existingAsset) => {
    const directory = await mkdtemp(join(tmpdir(), "nelcota-release-test-"));
    try {
      const assets = join(directory, "assets");
      await mkdir(assets);
      await writeFile(join(directory, "gh"), GITHUB_FIXTURE, { mode: 0o700 });
      await writeFile(join(directory, ARCHIVE), "rebuilt archive");

      if (existingAsset === "archive") {
        const interrupted = await publish(directory, true);
        expect(interrupted.exitCode).toBe(1);
        expect(await Bun.file(join(directory, "published")).exists()).toBe(false);
        await writeFile(join(directory, ARCHIVE), "new build");
      } else {
        await writeFile(join(directory, "draft"), "");
        await writeFile(join(assets, CHECKSUM), "checksum from a different build\n");
      }

      const result = await publish(directory);
      const repeat = await publish(directory);

      expect(result.exitCode, result.stderr).toBe(0);
      expect(repeat.exitCode, repeat.stderr).toBe(0);
      expect(await Bun.file(join(directory, "published")).exists()).toBe(true);
      expect(await Bun.file(join(assets, ARCHIVE)).text()).toBe("rebuilt archive");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
