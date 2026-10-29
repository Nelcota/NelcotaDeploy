import { text } from "drizzle-orm/sqlite-core";

// Platform tables store timestamps as UTC ISO 8601 strings, which sort lexicographically.
// Better Auth tables keep the millisecond integers its adapter expects.

export const createdAt = () => text("created_at").notNull();
export const updatedAt = () => text("updated_at").notNull();
