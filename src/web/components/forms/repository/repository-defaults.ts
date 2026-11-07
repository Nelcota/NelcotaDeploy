/** Selects a root Dockerfile or a unique candidate; ambiguous repositories require a choice. */
export function preferredDockerfile(dockerfiles: readonly string[], pathsLimited = false): string {
  if (dockerfiles.includes("Dockerfile")) {
    return "Dockerfile";
  }
  if (dockerfiles.length === 1 && pathsLimited === false) {
    return dockerfiles.at(0) ?? "";
  }
  return "";
}
