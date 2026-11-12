import { parseArgs } from "node:util";

import { getDatabase } from "@/db";
import { createLogger } from "@/logging";

import { getAuth } from "./auth";
import { SetupAlreadyDoneError } from "./auth.errors";
import { createUser, hasAdmin } from "./user.service";

const GENERATED_PASSWORD_BYTES = 18;
const logger = createLogger("bootstrap-admin");

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    "allow-additional": { type: "boolean", default: false },
    "if-missing": { type: "boolean", default: false },
  },
});

const email = values.email?.trim() ?? "";
const name = values.name?.trim() ?? "Administrador";
if (email === "" || email.includes("@") === false) {
  logger.error("usage: bun run admin:create --email you@example.com [--name 'Your Name']");
  process.exit(1);
}

const ifMissing = values["if-missing"];
const allowAdditional = values["allow-additional"];
if (ifMissing && allowAdditional) {
  logger.error("--if-missing and --allow-additional cannot be used together");
  process.exit(1);
}

const database = getDatabase();
if (allowAdditional === false && hasAdmin(database)) {
  if (ifMissing) {
    process.exit(0);
  }

  logger.error("an admin already exists; pass --allow-additional to create another one");
  process.exit(1);
}

// A password passed through the environment avoids shell history; otherwise one is generated.
const providedPassword = process.env["NELCOTA_ADMIN_PASSWORD"] ?? "";
if (ifMissing && providedPassword === "") {
  logger.error("NELCOTA_ADMIN_PASSWORD is required to provision the first admin with --if-missing");
  process.exit(1);
}

const password =
  providedPassword === ""
    ? Buffer.from(crypto.getRandomValues(new Uint8Array(GENERATED_PASSWORD_BYTES))).toString(
        "base64url",
      )
    : providedPassword;

try {
  await createUser(getAuth(), database, {
    newUser: { email, name, role: "admin", password },
    firstAdmin: allowAdditional === false,
    actor: {
      type: "system",
      label: "bootstrap-admin",
    },
  });
} catch (error) {
  if (ifMissing && error instanceof SetupAlreadyDoneError) {
    process.exit(0);
  }

  throw error;
}

logger.info({ email }, "admin account created");
if (providedPassword === "") {
  process.stdout.write(`\nGenerated password (shown only once): ${password}\n\n`);
}
