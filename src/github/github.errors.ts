/** Thrown when a GitHub API request fails or answers with an unexpected body. */
export class GitHubApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = "GitHubApiError";
    this.status = status;
  }
}
