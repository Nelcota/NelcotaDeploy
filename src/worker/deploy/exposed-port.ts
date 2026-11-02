const MAX_PORT = 65_535;
const EXPOSE_LINE = /^\s*EXPOSE\s+(.+)$/i;
const PORT_TOKEN = /^(\d+)(?:\/tcp)?$/i;
const FROM_LINE = /^\s*FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?\s*$/i;

function firstPort(arguments_: string): number | null {
  for (const token of arguments_.trim().split(/\s+/)) {
    const match = PORT_TOKEN.exec(token);
    const port = Number(match?.[1]);
    if (Number.isInteger(port) && port >= 1 && port <= MAX_PORT) {
      return port;
    }
  }
  return null;
}

function rememberStage(
  stages: Map<string, number | null>,
  name: string | null,
  port: number | null,
): void {
  if (name == null) {
    return;
  }
  stages.set(name, port);
}

/**
 * Finds the port an image says it listens on: the first port of the last EXPOSE that names
 * a literal port in the final stage. Earlier stages only contribute when inherited by name.
 *
 * @param dockerfile - Dockerfile text.
 * @returns The port, or null when no EXPOSE names a literal port (for example `EXPOSE $PORT`).
 */
export function detectExposedPort(dockerfile: string): number | null {
  let found: number | null = null;
  let stageName: string | null = null;
  const stages = new Map<string, number | null>();
  for (const line of dockerfile.split(/\r?\n/)) {
    const stage = FROM_LINE.exec(line);
    if (stage?.[1] != null) {
      rememberStage(stages, stageName, found);
      found = stages.get(stage[1].toLowerCase()) ?? null;
      stageName = stage[2]?.toLowerCase() ?? null;
      continue;
    }
    const match = EXPOSE_LINE.exec(line);
    if (match?.[1] == null) {
      continue;
    }
    found = firstPort(match[1]) ?? found;
  }
  return found;
}
