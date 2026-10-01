import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

const idSchema = z.string().regex(ULID_PATTERN, "must be a ULID");
const bbProjectIdSchema = z.string().startsWith("proj_");

/**
 * Where a connected board keeps its tasks. A folder is read fresh on every
 * request (see decisions/tasks-files-are-the-store.md), so it has no link to
 * report. A database has one: `live`, `reconnecting` or `offline`. Never a
 * token — the address is all a row says of how to reach the database; the
 * token leaves the service only in an invite, asked for by `databaseInvite`.
 */
export const syncedSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("folder") }).strict(),
  z
    .object({
      kind: z.literal("database"),
      url: z.string(),
      state: z.enum(["live", "reconnecting", "offline"]),
      lastSyncAt: z.string().nullable(),
    })
    .strict(),
]);

/**
 * A board connected to a source: a repository folder of markdown task files,
 * or an online database. A database board has no folder, no linked bb project
 * and no repository path.
 */
export const syncedFolderSchema = z
  .object({
    projectId: idSchema,
    projectName: z.string(),
    projectPrefix: z.string(),
    taskCount: z.number().int().nonnegative(),
    tasksFolder: z.string().nullable(),
    linkedBbProjectId: bbProjectIdSchema.nullable(),
    /** null when the linked bb project could not be resolved (best-effort). */
    linkedBbProjectName: z.string().nullable(),
    /** Local repository path of the linked bb project's default source. */
    repoPath: z.string().nullable(),
    source: syncedSourceSchema,
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
      "database_unreachable",
      "database_auth_failed",
      "database_not_empty",
      "turso_token_required",
      "turso_token_refused",
      "turso_api_failed",
    ]),
    message: z.string(),
  })
  .strict();

const addSyncedFolderResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), folder: syncedFolderSchema }).strict(),
  z.object({ ok: z.literal(false), error: folderDomainErrorSchema }).strict(),
]);

const tursoDatabaseSchema = z.object({ name: z.string(), url: z.string() }).strict();

const createDatabaseResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), url: z.string() }).strict(),
  z.object({ ok: z.literal(false), error: folderDomainErrorSchema }).strict(),
]);

const listTursoDatabasesResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), databases: z.array(tursoDatabaseSchema) }).strict(),
  z.object({ ok: z.literal(false), error: folderDomainErrorSchema }).strict(),
]);

const generateTursoApiTokenResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), token: z.string() }).strict(),
  z
    .object({ ok: z.literal(false), reason: z.enum(["cli_missing", "not_logged_in", "failed"]), message: z.string() })
    .strict(),
]);

const connectDatabaseInputSchema = z
  .object({
    url: z.string(),
    token: z.string().optional(),
    /** The Turso account token typed in place of a missing or refused one; saved once Turso accepts it. */
    tursoApiToken: z.string().optional(),
    /** A folder board whose tasks are copied into the database; the folder board stays as it is. */
    copyFromBoardId: idSchema.optional(),
    name: z.string().optional(),
    prefix: z.string().optional(),
  })
  .strict();

const boardRowSchema = z.object({ name: z.string(), prefix: z.string() }).strict();

const inspectDatabaseResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), board: boardRowSchema.nullable() }).strict(),
  z.object({ ok: z.literal(false), error: folderDomainErrorSchema }).strict(),
]);

const databaseInviteResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), invite: z.string() }).strict(),
  z.object({ ok: z.literal(false), error: folderDomainErrorSchema }).strict(),
]);

const connectDatabaseResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }).strict(),
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
  /** Takes a board off its source on this machine; a database board leaves the machine, its database stays. */
  removeSyncedFolder: {
    input: z.object({ projectId: idSchema }).strict(),
    output: z.object({ ok: z.literal(true) }).strict(),
  },
  /** Makes a database, named after the prefix when one is given; the account token, when given, is saved. Answers the address, never a token. */
  createDatabase: {
    input: z
      .object({ prefix: z.string().optional(), tursoApiToken: z.string().optional() })
      .strict(),
    output: createDatabaseResultSchema,
  },
  /** The databases of the saved Turso account. */
  listTursoDatabases: {
    input: z.null(),
    output: listTursoDatabasesResultSchema,
  },
  /** The board a database already holds, before connecting it — null for an empty one. */
  inspectDatabase: {
    input: z
      .object({ url: z.string(), token: z.string().optional(), tursoApiToken: z.string().optional() })
      .strict(),
    output: inspectDatabaseResultSchema,
  },
  connectDatabase: {
    input: connectDatabaseInputSchema,
    output: connectDatabaseResultSchema,
  },
  /** A Turso API token minted by the turso CLI of the host, for the dialog's field; it is saved only once Create is accepted. */
  generateTursoApiToken: {
    input: z.null(),
    output: generateTursoApiTokenResultSchema,
  },
  /** Whether a Turso account token is saved — never the token. */
  hasTursoApiToken: {
    input: z.null(),
    output: z.object({ saved: z.boolean() }).strict(),
  },
  /** The address of a database board with its saved token, for another machine to connect. */
  databaseInvite: {
    input: z.object({ boardId: idSchema }).strict(),
    output: databaseInviteResultSchema,
  },
  retryDatabase: {
    input: z.object({ boardId: idSchema }).strict(),
    output: z.object({ ok: z.literal(true) }).strict(),
  },
});

export type FoldersRpcContract = typeof foldersRpcContract;
export type SyncedFolder = z.infer<typeof syncedFolderSchema>;
export type ConnectDatabaseInput = z.infer<typeof connectDatabaseInputSchema>;
export type InspectDatabaseResult = z.infer<typeof inspectDatabaseResultSchema>;
export type BoardRow = z.infer<typeof boardRowSchema>;
export type SyncedSource = z.infer<typeof syncedSourceSchema>;
export type TursoDatabaseEntry = z.infer<typeof tursoDatabaseSchema>;
export type GenerateTursoApiTokenResult = z.infer<typeof generateTursoApiTokenResultSchema>;
export type SyncableBbProject = z.infer<typeof syncableBbProjectSchema>;
export type FolderDomainError = z.infer<typeof folderDomainErrorSchema>;

/** Realtime channel published when a board's connected folder changes. */
export interface FolderSyncChangedEvent {
  projectId: string;
}
