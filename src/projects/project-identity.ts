import { like } from "drizzle-orm";

import { type Database, tables } from "@/db";
import { MAX_SLUG_LENGTH, slugify } from "@/shared/schemas/project.schema";

/**
 * Suggests an available identifier without reserving it or changing an existing project.
 *
 * @param database - Database.
 * @param name - Project name.
 * @returns Available identifier, limited to the schema's maximum length.
 */
export function suggestProjectSlug(database: Database, name: string): string {
  const base = slugify(name);
  if (base === "") {
    throw new RangeError("Project name needs at least one letter or number for an identifier");
  }
  const occupied = new Set(
    database
      .select({ slug: tables.projects.slug })
      .from(tables.projects)
      .where(like(tables.projects.slug, `${base.slice(0, 1)}%`))
      .all()
      .map((row) => row.slug),
  );
  for (let sequence = 1; sequence <= occupied.size + 1; sequence += 1) {
    const suffix = sequence === 1 ? "" : `-${sequence}`;
    const candidate = `${base.slice(0, MAX_SLUG_LENGTH - suffix.length).replaceAll(/-+$/g, "")}${suffix}`;
    if (occupied.has(candidate) === false) {
      return candidate;
    }
  }
  throw new Error("Could not find an available project identifier");
}
