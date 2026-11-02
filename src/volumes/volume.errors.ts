/** Thrown when a volume does not exist or belongs to another project. */
export class VolumeNotFoundError extends Error {
  constructor(volumeId: string) {
    super(`Volume ${volumeId} not found`);
    this.name = "VolumeNotFoundError";
  }
}

/** Thrown when mounting a volume on a Docker Compose project, which has its own volumes. */
export class ComposeProjectVolumeError extends Error {
  constructor(projectId: string) {
    super(`Project ${projectId} runs with Docker Compose, so it cannot mount platform volumes`);
    this.name = "ComposeProjectVolumeError";
  }
}

/** Thrown when mounting a volume on a project that runs more than one replica. */
export class ReplicatedProjectVolumeError extends Error {
  constructor(projectId: string) {
    super(`Project ${projectId} runs several replicas, so it cannot mount volumes`);
    this.name = "ReplicatedProjectVolumeError";
  }
}

/** Thrown when a project already has the most volumes it may mount. */
export class VolumeLimitError extends Error {
  constructor(limit: number) {
    super(`A project can have at most ${limit} volumes`);
    this.name = "VolumeLimitError";
  }
}

/** Thrown when a mount path equals or nests inside another volume of the project. */
export class VolumePathOverlapError extends Error {
  constructor(mountPath: string, existing: string) {
    super(`Mount path ${mountPath} overlaps the volume at ${existing}`);
    this.name = "VolumePathOverlapError";
  }
}

/** Thrown when deleting the data of a volume that is still mounted. */
export class VolumeAttachedError extends Error {
  constructor(volumeId: string) {
    super(`Volume ${volumeId} is still attached`);
    this.name = "VolumeAttachedError";
  }
}

/** Thrown when changing a volume whose data is being deleted. */
export class VolumeBeingDeletedError extends Error {
  constructor(volumeId: string) {
    super(`The data of volume ${volumeId} is being deleted`);
    this.name = "VolumeBeingDeletedError";
  }
}

/** Thrown when moving a project whose volumes would stay behind on its current server. */
export class ProjectHasVolumesError extends Error {
  constructor(projectId: string) {
    super(`Project ${projectId} has volumes on its current server`);
    this.name = "ProjectHasVolumesError";
  }
}
