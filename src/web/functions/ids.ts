import { z } from "zod";

const MAX_ID_LENGTH = 100;

/** Schema for an id received from the browser. Shape only: ownership is checked by services. */
export const idSchema = z.string().trim().min(1).max(MAX_ID_LENGTH);

export const projectIdInput = z.object({ projectId: idSchema });
