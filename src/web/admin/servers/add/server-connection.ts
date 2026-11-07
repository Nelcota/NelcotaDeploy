import { parseCommandLine } from "@/shared/command-line";
import { CommandLineParseError } from "@/shared/command-line.errors";
import { serverInputSchema } from "@/shared/schemas/server.schema";

const MAX_CONNECTION_LENGTH = 1024;
const MAX_NAME_LENGTH = 60;
const DEFAULT_PORT = 22;
type Connection = { readonly host: string; readonly port: number; readonly username: string };

function validatedConnection(input: {
  readonly host: string;
  readonly port?: number;
  readonly username?: string;
}): Connection | null {
  const parsed = serverInputSchema.safeParse({ name: "server", ...input });
  if (parsed.success === false) {
    return null;
  }
  const { host, port, username } = parsed.data;
  return { host, port, username };
}

function connectionFromAddress(address: string): Connection | null {
  const raw = validatedConnection({ host: address });
  if (raw != null) {
    return raw;
  }
  const uri = address.startsWith("ssh://") ? address : `ssh://${address}`;
  if (URL.canParse(uri) === false) {
    return null;
  }
  const url = new URL(uri);
  if (
    url.protocol !== "ssh:" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    (url.pathname !== "" && url.pathname !== "/")
  ) {
    return null;
  }
  return validatedConnection({
    host: url.hostname.replaceAll(/^\[|\]$/g, ""),
    port: url.port === "" ? DEFAULT_PORT : Number(url.port),
    ...(url.username === "" ? {} : { username: url.username }),
  });
}

function connectionFromCommand(value: string): Connection | null {
  let args: string[];
  try {
    args = parseCommandLine(value);
  } catch (error) {
    if (error instanceof CommandLineParseError) {
      return null;
    }
    throw error;
  }
  if (args.at(0) !== "ssh") {
    return null;
  }
  let port: number | undefined;
  let username: string | undefined;
  let destination: string | undefined;
  for (let index = 1; index < args.length; index += 1) {
    const argument = args.at(index);
    if (argument == null) {
      return null;
    }
    const portOption = argument === "-p" || /^-p\d+$/.test(argument);
    if ((portOption && port != null) || (argument === "-l" && username != null)) {
      return null;
    }
    if (portOption) {
      const supplied = argument === "-p" ? args.at(++index) : argument.slice(2);
      port = supplied != null && /^\d{1,5}$/.test(supplied) ? Number(supplied) : Number.NaN;
      continue;
    }
    if (argument === "-l") {
      username = args.at(++index) ?? "";
      continue;
    }
    if (argument.startsWith("-") || destination != null) {
      return null;
    }
    destination = argument;
  }
  if (destination == null) {
    return null;
  }
  const connection = connectionFromAddress(destination);
  if (connection == null) {
    return null;
  }
  if (username != null && destination.includes("@")) {
    return null;
  }
  return validatedConnection({
    ...connection,
    ...(port == null ? {} : { port }),
    ...(username == null ? {} : { username }),
  });
}

/** Reads connection details without executing commands or accepting additional SSH options. */
export function parseServerConnection(value: string): Connection | null {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > MAX_CONNECTION_LENGTH || /[\r\n\0]/.test(trimmed)) {
    return null;
  }
  if (/^ssh\s/.test(trimmed)) {
    return connectionFromCommand(trimmed);
  }
  return connectionFromAddress(trimmed);
}

/** Suggests a free display name from the address while keeping all names within the form limit. */
export function suggestServerName(host: string, existingNames: readonly string[]): string {
  const isAddress = /^[\d.]+$/.test(host) || host.includes(":");
  const base = (
    isAddress ? `server-${host.replaceAll(/[.:]/g, "-")}` : (host.split(".").at(0) ?? "server")
  ).slice(0, MAX_NAME_LENGTH);
  const used = new Set(existingNames.map((name) => name.toLowerCase()));
  if (used.has(base.toLowerCase()) === false) {
    return base;
  }
  for (let suffix = 2; suffix <= used.size + 2; suffix += 1) {
    const ending = `-${suffix}`;
    const candidate = `${base.slice(0, MAX_NAME_LENGTH - ending.length)}${ending}`;
    if (used.has(candidate.toLowerCase()) === false) {
      return candidate;
    }
  }
  throw new Error("Unable to suggest an available server name");
}
