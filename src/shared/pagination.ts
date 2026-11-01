import { z } from "zod";

const MAX_CURSOR_ID_LENGTH = 128;

/** A stable position among rows ordered by creation time, then id, newest first. */
export const pageCursorSchema = z.object({
  createdAt: z.iso.datetime(),
  id: z.string().trim().min(1).max(MAX_CURSOR_ID_LENGTH),
});

/** Both ordering fields are required so equal timestamps never lose rows. */
export type PageCursor = z.output<typeof pageCursorSchema>;
