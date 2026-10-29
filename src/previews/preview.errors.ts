/** Thrown when a project already has the most previews running at once. */
export class PreviewLimitError extends Error {
  constructor(projectId: string, limit: number) {
    super(`Project ${projectId} already has ${limit} active previews`);
    this.name = "PreviewLimitError";
  }
}
