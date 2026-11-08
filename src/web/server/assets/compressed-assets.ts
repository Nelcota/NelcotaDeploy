import { resolve } from "node:path";

const MIN_COMPRESSED_BYTES = 1024;
const COMPRESSION_LEVEL = 6;

/** Precompresses immutable text assets once at build time, never on the request thread. */
export async function compressClientAssets(directory: string): Promise<void> {
  for await (const path of new Bun.Glob("**/*.{js,css,svg,json,html,txt}").scan({
    cwd: directory,
    absolute: true,
  })) {
    const file = Bun.file(path);
    if (file.size < MIN_COMPRESSED_BYTES) {
      continue;
    }
    const compressed = Bun.gzipSync(await file.bytes(), { level: COMPRESSION_LEVEL });
    if (compressed.byteLength < file.size) {
      await Bun.write(`${path}.gz`, compressed);
    }
  }
}

if (import.meta.main) {
  await compressClientAssets(resolve("dist/client"));
}
