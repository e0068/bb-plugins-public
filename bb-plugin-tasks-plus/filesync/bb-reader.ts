import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { FileReader } from "./scan.js";

/**
 * A FileReader backed by the linked BB project's workspace: lists and reads
 * repo-relative paths through bb.sdk.projects, so file access follows the
 * project to whichever host holds it.
 */
export function createBbFileReader(
  bb: BbPluginApi,
  bbProjectId: string,
): FileReader {
  return {
    async listPaths(folder) {
      const result = await bb.sdk.projects.paths({
        projectId: bbProjectId,
        includeFiles: "true",
        includeDirectories: "false",
        query: folder,
        limit: "5000",
      });
      return result.paths.map((entry) => entry.path);
    },
    async readFile(path) {
      const file = await bb.sdk.projects.fileContent({
        projectId: bbProjectId,
        path,
      });
      return file.contentEncoding === "base64"
        ? Buffer.from(file.content, "base64").toString("utf8")
        : file.content;
    },
  };
}
