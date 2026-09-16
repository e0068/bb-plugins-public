import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

const idSchema = z.string().regex(ULID_PATTERN, "must be a ULID");
const bbProjectIdSchema = z.string().startsWith("proj_");

/**
 * A board connected to a repository folder of markdown task files. There is
 * no sync status: files are read fresh on every request (see decisions/
 * tasks-files-are-the-store.md), so there is nothing to report progress on
 * or retry.
 */
export const syncedFolderSchema = z
  .object({
    projectId: idSchema,
    projectName: z.string(),
    projectPrefix: z.string(),
    taskCount: z.number().int().nonnegative(),
    tasksFolder: z.string(),
    linkedBbProjectId: bbProjectIdSchema,
    /** null when the linked bb project could not be resolved (best-effort). */
    linkedBbProjectName: z.string().nullable(),
    /** Local repository path of the linked bb project's default source. */
    repoPath: z.string().nullable(),
  })
  .strict();

export const syncableBbProjectSchema = z
  .object({
    id: bbProjectIdSchema,
    name: z.string(),
    repoPath: z.string().nullable(),
    /** Already backing a connected folder — the picker should flag/skip it. */
    alreadyConnected: z.boolean(),
  })
  .strict();

const folderPathSchema = z
  .string()
  .trim()
  .min(1, "must not be blank")
  .refine((value) => !value.startsWith("/"), {
    message: "must be a relative path",
  })
  .refine((value) => !value.split("/").includes(".."), {
    message: "must not contain '..' segments",
  });

export const folderDomainErrorSchema = z
  .object({
    code: z.enum([
      "folder_already_connected",
      "bb_project_not_found",
      "folder_connect_failed",
    ]),
    message: z.string(),
  })
  .strict();

const addSyncedFolderResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), folder: syncedFolderSchema }).strict(),
  z.object({ ok: z.literal(false), error: folderDomainErrorSchema }).strict(),
]);

export const foldersRpcContract = defineRpcContract({
  listSyncedFolders: {
    input: z.null(),
    output: z.object({ folders: z.array(syncedFolderSchema) }).strict(),
  },
  /** bb projects with a local repository, for the "Add folder" picker. */
  listSyncableBbProjects: {
    input: z.null(),
    output: z
      .object({ bbProjects: z.array(syncableBbProjectSchema) })
      .strict(),
  },
  addSyncedFolder: {
    input: z
      .object({
        bbProjectId: bbProjectIdSchema,
        tasksFolder: folderPathSchema,
      })
      .strict(),
    output: addSyncedFolderResultSchema,
  },
  removeSyncedFolder: {
    input: z.object({ projectId: idSchema }).strict(),
    output: z.object({ ok: z.literal(true) }).strict(),
  },
});

export type FoldersRpcContract = typeof foldersRpcContract;
export type SyncedFolder = z.infer<typeof syncedFolderSchema>;
export type SyncableBbProject = z.infer<typeof syncableBbProjectSchema>;
export type FolderDomainError = z.infer<typeof folderDomainErrorSchema>;

/** Realtime channel published when a board's connected folder changes. */
export interface FolderSyncChangedEvent {
  projectId: string;
}
