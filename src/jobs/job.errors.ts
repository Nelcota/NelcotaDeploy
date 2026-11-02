/** A worker tried to continue an execution it no longer owns. */
export class JobLeaseLostError extends Error {
  constructor(jobId: string) {
    super(`Worker no longer owns job ${jobId}`);
    this.name = "JobLeaseLostError";
  }
}
