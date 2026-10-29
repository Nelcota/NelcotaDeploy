import { parseGitHubRepository, slugify } from "@/shared/schemas/project.schema";

/**
 * Suggests a project name and identifier from a pasted repository URL, only for the fields
 * still empty, so nothing the user typed is overwritten.
 *
 * @param url - What is in the repository field now.
 * @param current - The `name` and `slug` currently in the form.
 * @returns The values to set; empty when the URL is not a GitHub repository yet.
 */
export function identityFromRepository(
  url: string,
  current: { readonly name: string; readonly slug: string },
): { name?: string; slug?: string } {
  const repository = parseGitHubRepository(url);
  if (repository == null) {
    return {};
  }
  return {
    ...(current.name.trim() === "" ? { name: repository.name } : {}),
    ...(current.slug.trim() === "" ? { slug: slugify(repository.name) } : {}),
  };
}
