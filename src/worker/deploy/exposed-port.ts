import { parseFinalDockerfileStage } from "@/shared/dockerfile";

const MAX_PORT = 65_535;
const PORT_TOKEN = /^(\d+)(?:\/tcp)?$/i;

function firstPort(arguments_: readonly string[]): number | null {
  for (const token of arguments_) {
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
 * a literal port in the final stage. Earlier stages only contribute when inherited by name.
 *
 * @param dockerfile - Dockerfile text.
 * @returns The port, or null when no EXPOSE names a literal port (for example `EXPOSE $PORT`).
 */
export function detectExposedPort(dockerfile: string): number | null {
  const stage = parseFinalDockerfileStage(dockerfile);
  if (stage == null) {
    return null;
  }
  let found: number | null = null;
  for (const instruction of stage.instructions) {
    if (instruction.getKeyword() !== "EXPOSE") {
      continue;
    }
    found = firstPort(instruction.getArguments().map((argument) => argument.getValue())) ?? found;
  }
  return found;
}
