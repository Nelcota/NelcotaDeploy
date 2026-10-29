const MAX_PORT = 65_535;
const EXPOSE_LINE = /^\s*EXPOSE\s+(.+)$/i;
const PORT_TOKEN = /^(\d+)(?:\/(?:tcp|udp))?$/i;

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

/**
 * Finds the port an image says it listens on: the first port of the last EXPOSE that names
 * a literal port. The last one wins because it belongs to the final build stage.
 *
 * @param dockerfile - Dockerfile text.
 * @returns The port, or null when no EXPOSE names a literal port (for example `EXPOSE $PORT`).
 */
export function detectExposedPort(dockerfile: string): number | null {
  let found: number | null = null;
  for (const line of dockerfile.split(/\r?\n/)) {
    const match = EXPOSE_LINE.exec(line);
    if (match?.[1] == null) {
      continue;
    }
    found = firstPort(match[1]) ?? found;
  }
  return found;
}
