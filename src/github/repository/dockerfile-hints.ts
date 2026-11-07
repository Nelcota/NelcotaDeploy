import { z } from "zod";

import { parseCommandLine } from "@/shared/command-line";
import { CommandLineParseError } from "@/shared/command-line.errors";
import { parseFinalDockerfileStage } from "@/shared/dockerfile";
import { isAllowedMountPath } from "@/shared/schemas/volume.schema";

import { healthCheckPathFromInstruction } from "./dockerfile-healthcheck";

const MAX_VOLUME_HINTS = 100;
const pathsSchema = z.array(z.string().max(200)).max(MAX_VOLUME_HINTS);
type StageHints = {
  readonly bun: boolean;
  readonly volumes: readonly string[];
  readonly limited: boolean;
  readonly healthCheckPath?: string | null;
};
const EMPTY_HINTS: StageHints = { bun: false, volumes: [], limited: false };

function volumePaths(value: string): { readonly paths: string[]; readonly limited: boolean } {
  let parsed: unknown;
  try {
    parsed = value.startsWith("[") ? JSON.parse(value) : parseCommandLine(value);
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof CommandLineParseError) {
      return { paths: [], limited: true };
    }
    throw error;
  }
  const result = pathsSchema.safeParse(parsed);
  if (result.success === false) {
    return { paths: [], limited: true };
  }
  const normalized = result.data.map((path) => path.replace(/\/+$/, ""));
  const paths = normalized.filter(isAllowedMountPath);
  return { paths, limited: paths.length !== result.data.length };
}

/** Finds literal volumes and a known Bun base in the final stage, including named-stage inheritance. */
export function parseDockerfileHints(text: string): StageHints {
  const stage = parseFinalDockerfileStage(text);
  if (stage == null) {
    return { ...EMPTY_HINTS, limited: true };
  }
  let current: StageHints = {
    ...EMPTY_HINTS,
    bun: /^(?:docker\.io\/)?oven\/bun(?::|@|$)/i.test(stage.baseImage ?? ""),
  };
  for (const instruction of stage.instructions) {
    const keyword = instruction.getKeyword();
    const arguments_ = instruction.getArgumentsContent();
    if (keyword === "ONBUILD") {
      current = Object.assign({}, current, { limited: true });
    }
    if (stage.baseImage != null && keyword === "HEALTHCHECK" && arguments_ != null) {
      current = Object.assign({}, current, {
        healthCheckPath: healthCheckPathFromInstruction(arguments_),
      });
    }
    if (stage.baseImage == null || keyword !== "VOLUME" || arguments_ == null) {
      continue;
    }
    const found = volumePaths(arguments_);
    const paths = [...new Set([...current.volumes, ...found.paths])];
    current = Object.assign({}, current, {
      volumes: paths.slice(0, MAX_VOLUME_HINTS),
      limited: current.limited || found.limited || paths.length > MAX_VOLUME_HINTS,
    });
  }
  return current;
}
