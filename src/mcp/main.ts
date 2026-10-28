import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import { verifyApiToken } from "@/auth";
import { requireConfigValue } from "@/config";
import { getDatabase } from "@/db";

import { createMcpServer } from "./mcp-server";

// stdout carries the MCP protocol, so diagnostics go to stderr only. Configuration is read
// lazily, so setting this before the first log line is enough.
process.env["LOG_STREAM"] = "stderr";
const token = requireConfigValue("NELCOTA_MCP_TOKEN");
const database = getDatabase();
if (verifyApiToken(database, token) == null) {
  process.stderr.write(
    "NELCOTA_MCP_TOKEN is invalid, revoked or expired. Create a token in Configurações > Tokens de API.\n",
  );
  process.exit(1);
}

const server = createMcpServer({ database, token });
await server.connect(new StdioServerTransport());
