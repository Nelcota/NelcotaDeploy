import { and, asc, eq, isNull } from "drizzle-orm";

import { type Actor, recordAuditEvent } from "@/audit";
import { type Database, tables, type Transaction } from "@/db";
import { enqueueJob } from "@/jobs";
import { getProject } from "@/projects";
import {
  MAX_VOLUMES_PER_PROJECT,
  mountPathsOverlap,
  type VolumeInput,
} from "@/shared/schemas/volume.schema";

import {
  ProjectHasVolumesError,
  VolumeAttachedError,
  VolumeBeingDeletedError,
  VolumeLimitError,
  VolumeNotFoundError,
  VolumePathOverlapError,
} from "./volume.errors";

const MAX_DELETION_ERROR_LENGTH = 500;

const volumeColumns = {
  id: tables.projectVolumes.id,
  mountPath: tables.projectVolumes.mountPath,
  attached: tables.projectVolumes.attached,
  deletionRequestedAt: tables.projectVolumes.deletionRequestedAt,
  deletionError: tables.projectVolumes.deletionError,
  createdAt: tables.projectVolumes.createdAt,
};

/** A directory of a project kept between deployments. */
export type ProjectVolume = {
  readonly id: string;
  readonly mountPath: string;
  /** Mounted by the next deployment; a detached volume keeps its data until deleted. */
  readonly attached: boolean;
  /** When deleting the data was requested; null when no deletion is pending. */
  readonly deletionRequestedAt: string | null;
  /** Why the last deletion failed, for the interface. */
  readonly deletionError: string | null;
  readonly createdAt: string;
};

type VolumeChange = {
  readonly projectId: string;
  readonly volumeId: string;
  readonly actor: Actor;
};

/**
 * Lists a project's volumes, by path.
 *
 * @param database - Database or open transaction.
 * @param projectId - Project id.
 * @returns The volumes.
 */
export function listProjectVolumes(
  database: Database | Transaction,
  projectId: string,
): ProjectVolume[] {
  return database
    .select(volumeColumns)
    .from(tables.projectVolumes)
    .where(eq(tables.projectVolumes.projectId, projectId))
    .orderBy(asc(tables.projectVolumes.mountPath))
    .all();
}

/**
 * Lists the volumes a new deployment mounts: attached, with no deletion pending.
 *
 * @param database - Database.
 * @param projectId - Project id.
 * @returns The volume ids and where they are mounted.
 */
export function listMountedVolumes(
  database: Database,
  projectId: string,
): { readonly id: string; readonly mountPath: string }[] {
  return database
    .select({ id: tables.projectVolumes.id, mountPath: tables.projectVolumes.mountPath })
    .from(tables.projectVolumes)
    .where(
      and(
        eq(tables.projectVolumes.projectId, projectId),
        eq(tables.projectVolumes.attached, true),
        isNull(tables.projectVolumes.deletionRequestedAt),
      ),
    )
    .orderBy(asc(tables.projectVolumes.mountPath))
    .all();
}

// Detached volumes count too: their data is still there and may be attached again.
function assertNoOverlap(volumes: readonly ProjectVolume[], mountPath: string): void {
  const overlapping = volumes.find((volume) => mountPathsOverlap(volume.mountPath, mountPath));
  if (overlapping != null) {
    throw new VolumePathOverlapError(mountPath, overlapping.mountPath);
  }
}

/**
 * Adds a volume to a project; the next deployment mounts it.
 *
 * @param database - Database.
 * @param request - Project, validated `input` and who adds it.
 * @returns The new volume.
 * @throws {ProjectNotFoundError} When the project does not exist.
 * @throws {VolumeLimitError} When the project already has 10 volumes.
 * @throws {VolumePathOverlapError} When the path equals or nests inside the path of another
 *   volume of the project, attached or not.
 */
export function addProjectVolume(
  database: Database,
  request: { readonly projectId: string; readonly input: VolumeInput; readonly actor: Actor },
): ProjectVolume {
  const { projectId, input, actor } = request;
  return database.transaction((transaction) => {
    getProject(transaction, projectId);
    const volumes = listProjectVolumes(transaction, projectId);
    if (volumes.length >= MAX_VOLUMES_PER_PROJECT) {
      throw new VolumeLimitError(MAX_VOLUMES_PER_PROJECT);
    }
    assertNoOverlap(volumes, input.mountPath);
    const volume = {
      id: Bun.randomUUIDv7(),
      mountPath: input.mountPath,
      attached: true,
      deletionRequestedAt: null,
      deletionError: null,
      createdAt: new Date().toISOString(),
    };
    transaction
      .insert(tables.projectVolumes)
      .values({ ...volume, projectId })
      .run();
    recordAuditEvent(transaction, {
      actor,
      action: "volume.add",
      targetType: "volume",
      targetId: volume.id,
      metadata: { projectId, mountPath: volume.mountPath },
    });
    return volume;
  });
}

function getProjectVolume(
  database: Database | Transaction,
  projectId: string,
  volumeId: string,
): ProjectVolume {
  const volume = listProjectVolumes(database, projectId).find((item) => item.id === volumeId);
  if (volume == null) {
    throw new VolumeNotFoundError(volumeId);
  }
  return volume;
}

/**
 * Attaches or detaches a volume. Detaching stops mounting it from the next deployment on and
 * keeps its data.
 *
 * @param database - Database.
 * @param change - Project, volume, who changes it and whether it should be `attached`.
 * @throws {VolumeNotFoundError} When the volume is not one of the project's.
 * @throws {VolumeBeingDeletedError} When its data is being deleted.
 */
export function setVolumeAttached(
  database: Database,
  change: VolumeChange & { readonly attached: boolean },
): void {
  const { projectId, volumeId, actor, attached } = change;
  database.transaction((transaction) => {
    const volume = getProjectVolume(transaction, projectId, volumeId);
    if (volume.deletionRequestedAt != null) {
      throw new VolumeBeingDeletedError(volumeId);
    }
    transaction
      .update(tables.projectVolumes)
      .set({ attached })
      .where(eq(tables.projectVolumes.id, volumeId))
      .run();
    recordAuditEvent(transaction, {
      actor,
      action: attached ? "volume.attach" : "volume.detach",
      targetType: "volume",
      targetId: volumeId,
      metadata: { projectId, mountPath: volume.mountPath },
    });
  });
}

/**
 * Queues the deletion of a detached volume's data on the project's server. The volume
 * disappears once the worker deleted it.
 *
 * @param database - Database.
 * @param change - Project, volume and who asks.
 * @throws {VolumeNotFoundError} When the volume is not one of the project's.
 * @throws {VolumeAttachedError} When the volume is still attached.
 * @throws {VolumeBeingDeletedError} When a deletion is already pending.
 */
export function requestVolumeDeletion(database: Database, change: VolumeChange): void {
  const { projectId, volumeId, actor } = change;
  database.transaction((transaction) => {
    const volume = getProjectVolume(transaction, projectId, volumeId);
    if (volume.attached) {
      throw new VolumeAttachedError(volumeId);
    }
    if (volume.deletionRequestedAt != null) {
      throw new VolumeBeingDeletedError(volumeId);
    }
    const now = new Date();
    transaction
      .update(tables.projectVolumes)
      .set({ deletionRequestedAt: now.toISOString(), deletionError: null })
      .where(eq(tables.projectVolumes.id, volumeId))
      .run();
    enqueueJob(
      transaction,
      {
        kind: "volume_delete",
        projectId,
        payload: { volumeId },
        dedupeKey: `volume-delete:${volumeId}`,
      },
      now,
    );
    recordAuditEvent(transaction, {
      actor,
      action: "volume.delete",
      targetType: "volume",
      targetId: volumeId,
      metadata: { projectId, mountPath: volume.mountPath },
    });
  });
}

/**
 * Removes a volume once the worker deleted its data.
 *
 * @param database - Database.
 * @param volumeId - Volume whose data is gone.
 */
export function finishVolumeDeletion(database: Database, volumeId: string): void {
  database.delete(tables.projectVolumes).where(eq(tables.projectVolumes.id, volumeId)).run();
}

/**
 * Records why deleting a volume's data failed, so the interface can show it and the user can
 * try again.
 *
 * @param database - Database.
 * @param volumeId - Volume whose deletion failed.
 * @param reason - What went wrong, without secrets.
 */
export function failVolumeDeletion(database: Database, volumeId: string, reason: string): void {
  database
    .update(tables.projectVolumes)
    .set({ deletionRequestedAt: null, deletionError: reason.slice(0, MAX_DELETION_ERROR_LENGTH) })
    .where(eq(tables.projectVolumes.id, volumeId))
    .run();
}

/**
 * Refuses to move a project that has volumes: their data lives on the current server.
 *
 * @param database - Database or open transaction.
 * @param projectId - Project being moved.
 * @throws {ProjectHasVolumesError} When the project has any volume, attached or not.
 */
export function assertProjectHasNoVolumes(
  database: Database | Transaction,
  projectId: string,
): void {
  if (listProjectVolumes(database, projectId).length > 0) {
    throw new ProjectHasVolumesError(projectId);
  }
}
