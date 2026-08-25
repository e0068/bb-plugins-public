import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

const idSchema = z.string().regex(ULID_PATTERN, "must be a ULID");
const bbProjectIdSchema = z.string().startsWith("proj_");

export const folderSyncSummarySchema = z
  .object({
    created: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    adopted: z.number().int().nonnegative(),
    deleted: z.number().int().nonnegative(),
    /** Files whose frontmatter failed to parse — see `invalidFiles` below
     * for path/reason detail; this is just the count. */
    invalid: z.number().int().nonnegative(),
  })
  .strict();

/**
 * Per-project file-sync status. "syncing" is transient (never persisted —
 * see FolderSyncStatusStore); the other three kinds are what a client sees
 * after a load/reload.
 */
export const folderSyncStatusSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("not_synced") }).strict(),
  z.object({ kind: z.literal("syncing") }).strict(),
  z
    .object({
      kind: z.literal("synced"),
      syncedAt: z.string(),
      summary: folderSyncSummarySchema,
      /** Path + reason for each file this sync couldn't read (unreadable
       * frontmatter) — the file's task, if any, was left untouched. */
      invalidFiles: z
        .array(z.object({ path: z.string(), reason: z.string() }).strict())
        .default([]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("error"),
      failedAt: z.string(),
      message: z.string(),
    })
    .strict(),
]);

/** A connected sync folder: a tasks-plugin project with tasksFolder set. */
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
    status: folderSyncStatusSchema,
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
    input: z
      .object({
        projectId: idSchema,
        /** Also delete tasks linked to this folder via file_tasks. */
        alsoDeleteTasks: z.boolean().default(false),
      })
      .strict(),
    output: z
      .object({ ok: z.literal(true), deletedTaskCount: z.number().int().nonnegative() })
      .strict(),
  },
  syncFolderNow: {
    input: z.object({ projectId: idSchema }).strict(),
    // null when the project is no longer sync-eligible (e.g. disconnected
    // concurrently) by the time the sync finishes.
    output: z.object({ folder: syncedFolderSchema.nullable() }).strict(),
  },
});

export type FoldersRpcContract = typeof foldersRpcContract;
export type SyncedFolder = z.infer<typeof syncedFolderSchema>;
export type SyncableBbProject = z.infer<typeof syncableBbProjectSchema>;
export type FolderSyncStatusDto = z.infer<typeof folderSyncStatusSchema>;
export type FolderSyncSummary = z.infer<typeof folderSyncSummarySchema>;
export type FolderDomainError = z.infer<typeof folderDomainErrorSchema>;

/** Realtime channel published on every folder sync status transition. */
export interface FolderSyncChangedEvent {
  projectId: string;
}
