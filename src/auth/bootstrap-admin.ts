import { parseArgs } from "node:util";

import { getDatabase } from "@/db";
import { createLogger } from "@/logging";

import { getAuth } from "./auth";
import { createUser, hasAdmin } from "./user.service";

const GENERATED_PASSWORD_BYTES = 18;
const logger = createLogger("bootstrap-admin");

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    "allow-additional": { type: "boolean", default: false },
  },
});

const email = values.email?.trim() ?? "";
const name = values.name?.trim() ?? "Administrador";
if (email === "" || email.includes("@") === false) {
  logger.error("usage: bun run admin:create --email you@example.com [--name 'Your Name']");
  process.exit(1);
}

const database = getDatabase();
if (hasAdmin(database) && values["allow-additional"] === false) {
  logger.error("an admin already exists; pass --allow-additional to create another one");
  process.exit(1);
}

// A password passed through the environment avoids shell history; otherwise one is generated.
const providedPassword = process.env["NELCOTA_ADMIN_PASSWORD"] ?? "";
const password =
  providedPassword === ""
    ? Buffer.from(crypto.getRandomValues(new Uint8Array(GENERATED_PASSWORD_BYTES))).toString(
        "base64url",
      )
    : providedPassword;

await createUser(
  getAuth(),
  database,
  { email, name, role: "admin", password },
  {
    type: "system",
    label: "bootstrap-admin",
  },
);

logger.info({ email }, "admin account created");
if (providedPassword === "") {
  process.stdout.write(`\nGenerated password (shown only once): ${password}\n\n`);
}
