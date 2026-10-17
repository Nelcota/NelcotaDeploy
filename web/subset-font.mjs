// Subsets the Outfit variable font to the characters the panel uses (Basic
// Latin, the accented letters Portuguese uses, and a few typographic marks),
// keeping the weight axis.
// Usage: node subset-font.mjs input.woff2 output.woff2 (run by scripts/web-vendor.sh).
import { readFile, writeFile } from "node:fs/promises";
import subsetFont from "subset-font";

const [, , input, output] = process.argv;
let text = "";
for (let c = 0x20; c < 0x7f; c++) text += String.fromCharCode(c);
// Accented letters (a, c, e, i, o, u with acute, circumflex, tilde, grave, cedilla, diaeresis) and ordinal indicators.
for (const c of [0xe0, 0xe1, 0xe2, 0xe3, 0xe7, 0xe9, 0xea, 0xed, 0xf3, 0xf4, 0xf5, 0xfa, 0xfc, 0xc0, 0xc1, 0xc2, 0xc3, 0xc7, 0xc9, 0xca, 0xcd, 0xd3, 0xd4, 0xd5, 0xda, 0xdc, 0xaa, 0xba]) text += String.fromCharCode(c);
text += "·•…–—×’‘“”→←↑↓✓−±°©›";
const font = await readFile(input);
const subset = await subsetFont(font, text, { targetFormat: "woff2" });
await writeFile(output, subset);
console.log(`${input}: ${font.length} -> ${subset.length} bytes`);
