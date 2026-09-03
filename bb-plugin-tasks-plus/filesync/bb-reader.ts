import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { FileReader } from "./scan.js";

/**
 * A FileReader backed by the linked BB project's workspace: lists and reads
 * repo-relative paths through bb.sdk.projects, so file access follows the
 * project to whichever host holds it.
 *
 * `environmentId`, when given, routes both calls at an active worktree's
 * workspace instead of the project's main checkout (`ProjectWorkspaceRoutingArgs`
 * on `bb.sdk.projects.paths`/`fileContent` — same RPCs, no separate
 * `bb.sdk.environments.*` read path needed). The branching below (rather than
 * a spread) is required by that arg type: it's a discriminated union of
 * "environmentId" xor "hostId" xor neither, which a plain
 * `{ ...(environmentId ? { environmentId } : {}) }` can't satisfy.
 */
export function createBbFileReader(
  bb: BbPluginApi,
  bbProjectId: string,
  environmentId?: string,
): FileReader {
  return {
    async listPaths(folder) {
      const result = environmentId
        ? await bb.sdk.projects.paths({
            projectId: bbProjectId,
            environmentId,
            includeFiles: "true",
            includeDirectories: "false",
            query: folder,
            limit: "5000",
          })
        : await bb.sdk.projects.paths({
            projectId: bbProjectId,
            includeFiles: "true",
            includeDirectories: "false",
            query: folder,
            limit: "5000",
          });
      return result.paths.map((entry) => entry.path);
    },
    async readFile(path) {
      const file = environmentId
        ? await bb.sdk.projects.fileContent({
            projectId: bbProjectId,
            environmentId,
            path,
          })
        : await bb.sdk.projects.fileContent({
            projectId: bbProjectId,
            path,
          });
      return file.contentEncoding === "base64"
        ? Buffer.from(file.content, "base64").toString("utf8")
        : file.content;
    },
  };
}
