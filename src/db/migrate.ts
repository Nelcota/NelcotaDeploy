import { getConfig } from "@/config";
import { createLogger } from "@/logging";

import { migrateDatabase, openDatabase } from "./database";

const logger = createLogger("migrate");
const databasePath = getConfig().DATABASE_PATH;

migrateDatabase(openDatabase(databasePath));
logger.info({ databasePath }, "database migrations applied");
