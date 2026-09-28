// Layer 2 — the paths the branch removed since its merge-base, read from git
// in the working copy: bb's status names a rename only by its new path, so
// the old one comes from here (see core/changed-files.ts withDeletedPaths).
import { deletedPathsArgs, parseNulPaths } from "../core/changed-files";
import { type GitPorts, gitRunMessage } from "./git-run";

/** Throws when git can't answer: a PR built without the deletions would copy every moved file instead of moving it. */
export async function deletedPathsSince(ports: GitPorts, mergeBaseSha: string): Promise<string[]> {
  const listed = await ports.run(deletedPathsArgs(mergeBaseSha));
  if (listed.code !== 0) throw new Error(`listing the branch's deleted files: ${gitRunMessage(listed)}`);
  return parseNulPaths(listed.stdout);
}
