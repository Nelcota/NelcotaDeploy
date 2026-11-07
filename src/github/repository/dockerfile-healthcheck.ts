import { z } from "zod";

import { parseCommandLine } from "@/shared/command-line";
import { CommandLineParseError } from "@/shared/command-line.errors";
import { projectInputSchema } from "@/shared/schemas/project.schema";

const LOCAL_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);
const commandSchema = z.array(z.string().max(4096)).min(1).max(64);

/** Extracts a single literal HTTP GET probe to the local application without running its command. */
export function healthCheckPathFromInstruction(instruction: string): string | null {
  const body = instruction.replace(/^(?:--[a-z-]+=\S+\s+)*/i, "");
  const command = /^CMD\s+(.+)$/i.exec(body)?.[1];
  if (command == null || /[$`\r\n]/.test(command)) {
    return null;
  }
  let value: unknown;
  try {
    value = command.startsWith("[") ? JSON.parse(command) : parseCommandLine(command);
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof CommandLineParseError) {
      return null;
    }
    throw error;
  }
  const parsed = commandSchema.safeParse(value);
  if (parsed.success === false) {
    return null;
  }
  const executable = parsed.data.at(0);
  if (executable !== "curl" && executable !== "wget") {
    return null;
  }
  if (
    parsed.data.some((argument) =>
      /^(?:-X|--request|-I|--head|--method|--post|--data|-d|-H|--header|-u|--user|-b|--cookie)/.test(
        argument,
      ),
    )
  ) {
    return null;
  }
  const urls = parsed.data.filter((argument) => /^https?:\/\//i.test(argument));
  const literal = urls.at(0);
  if (urls.length !== 1 || literal == null || URL.canParse(literal) === false) {
    return null;
  }
  const harmlessOptions =
    /^(?:-[fsSq]+|-O-?|-|\/dev\/null|--fail|--fail-with-body|--silent|--show-error|--quiet|\|\||exit|1)$/;
  if (
    parsed.data
      .slice(1)
      .some((argument) => argument !== literal && harmlessOptions.test(argument) === false)
  ) {
    return null;
  }
  const url = new URL(literal);
  if (
    url.protocol !== "http:" ||
    LOCAL_HOSTS.has(url.hostname) === false ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return null;
  }
  const path = projectInputSchema.shape.healthCheckPath.safeParse(url.pathname);
  return path.success ? path.data : null;
}
