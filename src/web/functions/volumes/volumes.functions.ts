import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { userActor } from "@/auth";
import { getDatabase } from "@/db";
import { applyRuntimeChanges } from "@/deployments";
import { volumeInputSchema } from "@/shared/schemas/volume.schema";
import {
  addProjectVolume,
  listProjectVolumes,
  requestVolumeDeletion,
  setVolumeAttached,
} from "@/volumes";
import { authorize } from "@/web/server/authorization";

import { idSchema, projectIdInput } from "../ids";

const volumeTarget = { projectId: idSchema, volumeId: idSchema };

export const listVolumesFn = createServerFn({ method: "GET" })
  .validator(projectIdInput)
  .handler(async ({ data }) => {
    await authorize("project:read");
    return listProjectVolumes(getDatabase(), data.projectId);
  });

/** Adds a volume; projects that apply changes on their own are recreated with it. */
export const addVolumeFn = createServerFn({ method: "POST" })
  .validator(z.object({ projectId: idSchema, volume: volumeInputSchema }))
  .handler(async ({ data }) => {
    const user = await authorize("project:write");
    const database = getDatabase();
    addProjectVolume(database, {
      projectId: data.projectId,
      input: data.volume,
      actor: userActor(user),
    });
    applyRuntimeChanges(database, data.projectId, {
      actor: userActor(user),
      triggeredByUserId: user.id,
    });
  });

/** Attaches or detaches a volume; detaching keeps its data. */
export const setVolumeAttachedFn = createServerFn({ method: "POST" })
  .validator(z.object({ ...volumeTarget, attached: z.boolean() }))
  .handler(async ({ data }) => {
    const user = await authorize("project:write");
    const database = getDatabase();
    setVolumeAttached(database, { ...data, actor: userActor(user) });
    applyRuntimeChanges(database, data.projectId, {
      actor: userActor(user),
      triggeredByUserId: user.id,
    });
  });

/** Deletes the data of a detached volume; only those who may delete projects can do it. */
export const deleteVolumeDataFn = createServerFn({ method: "POST" })
  .validator(z.object(volumeTarget))
  .handler(async ({ data }) => {
    const user = await authorize("project:delete");
    requestVolumeDeletion(getDatabase(), { ...data, actor: userActor(user) });
  });
