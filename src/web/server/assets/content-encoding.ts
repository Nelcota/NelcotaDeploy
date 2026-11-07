/** Honors explicit gzip refusal before a wildcard and rejects malformed quality values. */
export function acceptsGzip(header: string | null): boolean {
  if (header == null || header.trim() === "") {
    return false;
  }
  let wildcard = false;
  for (const entry of header.toLowerCase().split(",")) {
    const [rawCoding, ...parameters] = entry.trim().split(";");
    const coding = rawCoding?.trim();
    if (coding !== "gzip" && coding !== "*") {
      continue;
    }
    const parameter = parameters.at(0)?.trim();
    const match = parameter?.match(/^q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/);
    const quality = parameter == null ? 1 : Number(match?.at(1));
    const accepted =
      parameters.length <= 1 && Number.isFinite(quality) && quality > 0 && quality <= 1;
    if (coding === "gzip") {
      return accepted;
    }
    wildcard = accepted;
  }
  return wildcard;
}
