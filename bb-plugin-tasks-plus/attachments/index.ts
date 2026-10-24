import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { Attachment } from "../db/types.js";
import type { FileTasksStore } from "../filesync/store.js";
import type { CallerEnvironmentCache } from "../filesync/caller-cache.js";
import { runInCallerScope } from "../filesync/caller-scope.js";
import { outOfReach, type BlobStore } from "../filesync/task-repo.js";
import { CALLER_THREAD_FIELD } from "../shared/enums.js";
import { attachmentDownloadUrl, attachmentDownloadUrls, removeAttachmentDescriptionReferences } from "../shared/attachment-url.js";

export const MAX_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024;

const INLINE_RASTER_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
]);

const RASTER_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
};

const UPLOAD_PATH = "/attachments/upload";
const DOWNLOAD_PATH = "/attachments/download";
const DELETE_PATH = "/attachments/delete";
const MIME_PATTERN =
  /^(application|audio|font|image|message|model|multipart|text|video)\/[!#$&^_.+\-A-Za-z0-9]+$/;
const storeRoots = new WeakMap<FileTasksStore, string>();

export type AttachmentOwner =
  | { taskId: string; commentId?: never }
  | { taskId?: never; commentId: string };

export type SaveAttachmentFromBytesOptions = AttachmentOwner & {
  fileName: string;
  mime?: string;
};

interface DatabaseListRow {
  name: string;
  file: string;
}

type PluginHttpContext = Parameters<
  Parameters<BbPluginApi["http"]["route"]>[2]
>[0];

class AttachmentRequestError extends Error {
  constructor(
    readonly status: 400 | 413,
    message: string,
  ) {
    super(message);
  }
}

export class AttachmentReferencedError extends Error {
  constructor(readonly attachment: Attachment) {
    super(
      `Attachment "${attachment.fileName}" is used in the task description. Remove it from the description before deleting the attachment.`,
    );
    this.name = "AttachmentReferencedError";
  }
}

export class AttachmentCleanupError extends Error {
  constructor(
    readonly attachment: Attachment,
    readonly cleanupCause: unknown,
  ) {
    super(`Failed to remove attachment blob: ${attachment.fileName}`);
    this.name = "AttachmentCleanupError";
  }
}

function pluginDataDirectory(bb: BbPluginApi): string {
  const main = bb.storage
    .database()
    .prepare<[], DatabaseListRow>("PRAGMA database_list")
    .all()
    .find((database) => database.name === "main");
  if (!main?.file) {
    throw new Error("Tasks attachment storage requires a file-backed database");
  }
  return dirname(main.file);
}

function requireStoreRoot(store: FileTasksStore): string {
  const root = storeRoots.get(store);
  if (!root) {
    throw new Error(
      "Tasks attachment helpers require registerAttachments(bb, store) first",
    );
  }
  return root;
}

function pathInside(root: string, blobPath: string): string {
  const absoluteRoot = resolve(root);
  const absolutePath = resolve(absoluteRoot, blobPath);
  if (
    absolutePath !== absoluteRoot &&
    !absolutePath.startsWith(`${absoluteRoot}${sep}`)
  ) {
    throw new Error("Attachment blob path escapes the plugin data directory");
  }
  return absolutePath;
}

/**
 * Removes the files of attachments from this machine's disk and, for a
 * database project, from the database every machine reads them from —
 * `cloud` is that project's `store.projectBlobs`, resolved while the project
 * is still known.
 */
export async function removeAttachmentBlobs(
  bb: BbPluginApi,
  store: FileTasksStore,
  attachments: readonly Pick<Attachment, "id" | "blobPath">[],
  cloud: BlobStore | null,
): Promise<void> {
  if (attachments.length === 0) return;
  const root = requireStoreRoot(store);
  const removals = await Promise.allSettled(
    attachments.map(async (attachment) => {
      const absolutePath = pathInside(root, attachment.blobPath);
      await rm(dirname(absolutePath), { recursive: true, force: true });
      await cloud?.remove(attachment.id);
    }),
  );
  const failures = removals.flatMap((result, index) => {
    if (result.status === "fulfilled") return [];
    const attachment = attachments[index];
    const message =
      result.reason instanceof Error
        ? result.reason.message
        : String(result.reason);
    bb.log.warn(
      `failed to remove attachment blob ${attachment?.id ?? "unknown"}: ${message}`,
    );
    return [result.reason];
  });
  if (failures.length > 0) {
    throw new AggregateError(failures, "Failed to remove attachment blobs");
  }
}

/**
 * RFC 6266 Content-Disposition. Header values must be ByteStrings, so the
 * legacy `filename=` parameter carries an ASCII-only fallback and the real
 * name travels percent-encoded in `filename*`. A raw name with an em dash,
 * CJK, or emoji in `filename=` makes the Response constructor throw and turns
 * every download of that attachment into a 500 (issue #1621).
 */
function buildContentDisposition(
  disposition: "inline" | "attachment",
  fileName: string,
): string {
  const visibleName = fileName.replace(BIDI_CONTROL_PATTERN, "_");
  const asciiFallback = visibleName
    .replace(/[^\x20-\x7e]/g, "-")
    .replace(/["\\]/g, "_");
  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encodeExtValue(visibleName)}`;
}

/**
 * RFC 5987 `attr-char`: ALPHA / DIGIT / ! # $ & + - . ^ _ ` | ~. Every other
 * byte of the UTF-8 encoding is percent-encoded. `encodeURIComponent` alone
 * keeps `* ' ( )`, which strict parsers reject inside `filename*`.
 */
function encodeExtValue(value: string): string {
  let encoded = "";
  for (const byte of Buffer.from(value, "utf8")) {
    const char = String.fromCharCode(byte);
    encoded += /[A-Za-z0-9!#$&+\-.^_`|~]/.test(char)
      ? char
      : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return encoded;
}

/**
 * Unicode bidirectional controls (LRM/RLM, ALM, LRE..RLO, LRI..PDI) can make a
 * name such as `photo<RLO>gnp.exe` render as `photoexe.png` and hide the real
 * extension. They become `_` in stored names and in download headers.
 */
const BIDI_CONTROL_PATTERN = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

function sanitizeFileName(fileName: string): string {
  const baseName = fileName
    .normalize("NFC")
    .replaceAll("\\", "/")
    .split("/")
    .at(-1)
    ?.trim();
  let sanitized = (baseName ?? "")
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "_")
    .replace(BIDI_CONTROL_PATTERN, "_")
    .replace(/^\.+/, "")
    .trim();
  while (Buffer.byteLength(sanitized, "utf8") > 180) {
    sanitized = sanitized.slice(0, -1);
  }
  if (!sanitized || sanitized === "." || sanitized === "..") {
    return "attachment";
  }
  return sanitized;
}

function normalizeMime(mime: string): string {
  const normalized = mime.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!MIME_PATTERN.test(normalized)) {
    throw new AttachmentRequestError(400, "mime must be a valid MIME type");
  }
  return normalized;
}

export function isInlineRasterMime(mime: string): boolean {
  return INLINE_RASTER_MIMES.has(
    mime.split(";", 1)[0]?.trim().toLowerCase() ?? "",
  );
}

function bytesMatch(
  bytes: Uint8Array,
  offset: number,
  expected: readonly number[],
): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function sniffRasterMime(bytes: Uint8Array): string | undefined {
  if (bytesMatch(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (bytesMatch(bytes, 0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (
    bytesMatch(bytes, 0, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
    bytesMatch(bytes, 0, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  ) {
    return "image/gif";
  }
  if (
    bytesMatch(bytes, 0, [0x52, 0x49, 0x46, 0x46]) &&
    bytesMatch(bytes, 8, [0x57, 0x45, 0x42, 0x50])
  ) {
    return "image/webp";
  }
  if (
    bytesMatch(bytes, 4, [0x66, 0x74, 0x79, 0x70]) &&
    (bytesMatch(bytes, 8, [0x61, 0x76, 0x69, 0x66]) ||
      bytesMatch(bytes, 8, [0x61, 0x76, 0x69, 0x73]))
  ) {
    return "image/avif";
  }
  return undefined;
}

function inferMimeFromBytes(bytes: Uint8Array, fileName: string): string {
  const sniffed = sniffRasterMime(bytes.subarray(0, 12));
  if (sniffed) return sniffed;
  const extension = fileName.toLowerCase().match(/\.[^.]+$/u)?.[0];
  return (
    (extension && RASTER_MIME_BY_EXTENSION[extension]) ??
    "application/octet-stream"
  );
}

function normalizeOwner(
  taskId: string | null | undefined,
  commentId: string | null | undefined,
): AttachmentOwner {
  const normalizedTaskId = taskId?.trim() || undefined;
  const normalizedCommentId = commentId?.trim() || undefined;
  if (Boolean(normalizedTaskId) === Boolean(normalizedCommentId)) {
    throw new AttachmentRequestError(
      400,
      "exactly one of taskId or commentId is required",
    );
  }
  if (normalizedTaskId) return { taskId: normalizedTaskId };
  if (normalizedCommentId) return { commentId: normalizedCommentId };
  throw new Error("unreachable attachment owner state");
}

function attachmentParameters(context: PluginHttpContext): {
  owner: AttachmentOwner;
  fileName: string;
  mime: string;
  /** Тред, из которого грузят файл: загрузка идёт своим HTTP-роутом, и
   *  другого места для него в запросе нет. */
  callerThreadId: string | null;
} {
  const query = context.req.query();
  const owner = normalizeOwner(
    query.taskId ?? context.req.header("x-task-id"),
    query.commentId ?? context.req.header("x-comment-id"),
  );
  const requestedFileName =
    query.fileName ?? context.req.header("x-file-name") ?? "";
  if (!requestedFileName.trim()) {
    throw new AttachmentRequestError(400, "fileName is required");
  }
  const requestedMime =
    query.mime ??
    context.req.header("x-mime-type") ??
    context.req.header("content-type") ??
    "";
  const callerThreadId = query[CALLER_THREAD_FIELD] ?? null;
  return {
    owner,
    callerThreadId,
    fileName: sanitizeFileName(requestedFileName),
    mime: normalizeMime(requestedMime),
  };
}

async function readRequestBody(request: Request): Promise<Uint8Array> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_ATTACHMENT_SIZE_BYTES
  ) {
    throw new AttachmentRequestError(413, "attachment exceeds the 25 MB limit");
  }
  if (!request.body) return new Uint8Array();

  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_ATTACHMENT_SIZE_BYTES) {
        await reader.cancel();
        throw new AttachmentRequestError(
          413,
          "attachment exceeds the 25 MB limit",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** Where an attachment's file lies once its upload is done; before that its record points at `blobs/pending`. */
const finalBlobPath = (id: string, fileName: string): string => join("blobs", id, fileName);

async function persistAttachment(
  store: FileTasksStore,
  owner: AttachmentOwner,
  fileName: string,
  mime: string,
  bytes: Uint8Array,
): Promise<Attachment> {
  const sizeBytes = bytes.byteLength;
  if (sizeBytes > MAX_ATTACHMENT_SIZE_BYTES) {
    throw new AttachmentRequestError(413, "attachment exceeds the 25 MB limit");
  }
  const safeFileName = sanitizeFileName(fileName);
  const safeMime = normalizeMime(mime);
  const attachment = await store.createAttachment({
    ...owner,
    fileName: safeFileName,
    mime: safeMime,
    sizeBytes,
    blobPath: join("blobs", "pending", safeFileName),
    isImage: isInlineRasterMime(safeMime),
  });
  const blobPath = finalBlobPath(attachment.id, safeFileName);
  const absolutePath = pathInside(requireStoreRoot(store), blobPath);
  const cloud = await store.attachmentBlobs(attachment.id);

  try {
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, bytes);
    // A database project's file goes where every machine of the board reads it.
    await cloud?.write(attachment.id, bytes);
    return await store.updateAttachment(attachment.id, {
      blobPath,
    });
  } catch (error) {
    await store.deleteAttachment(attachment.id);
    await rm(dirname(absolutePath), { recursive: true, force: true });
    // Parts that did reach the database go too; failing that, the upload's own error is the one to tell.
    await cloud?.remove(attachment.id).catch(() => undefined);
    throw error;
  }
}

const isMissingFile = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

/** The file on this machine's disk; `null` — none, or one cut short. */
async function diskBytes(absolutePath: string, sizeBytes: number): Promise<Uint8Array | null> {
  try {
    const bytes = await readFile(absolutePath);
    return bytes.byteLength === sizeBytes ? bytes : null;
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

/** Puts the file in place whole: a reader alongside sees the old file or the new one, never a part. */
async function writeWhole(absolutePath: string, bytes: Uint8Array): Promise<void> {
  const partial = `${absolutePath}.part-${randomUUID()}`;
  try {
    await writeFile(partial, bytes);
    await rename(partial, absolutePath);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
}

/**
 * An attachment's file: from this machine's disk, or — uploaded on another
 * machine of a database project — from the database, kept on disk after
 * the first read. `null` — the file is nowhere, or its upload is not done.
 */
async function storedBytes(store: FileTasksStore, attachment: Attachment): Promise<Uint8Array | null> {
  const absolutePath = pathInside(requireStoreRoot(store), attachment.blobPath);
  const onDisk = await diskBytes(absolutePath, attachment.sizeBytes);
  if (onDisk !== null) return onDisk;
  if (attachment.blobPath !== finalBlobPath(attachment.id, attachment.fileName)) return null;
  const cloud = await store.attachmentBlobs(attachment.id);
  const bytes = (await cloud?.read(attachment.id)) ?? null;
  if (bytes === null) return null;
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeWhole(absolutePath, bytes);
  return bytes;
}

export async function saveAttachmentFromBytes(
  store: FileTasksStore,
  bytes: Uint8Array,
  options: SaveAttachmentFromBytesOptions,
): Promise<Attachment> {
  return persistAttachment(
    store,
    normalizeOwner(options.taskId, options.commentId),
    options.fileName,
    options.mime ?? inferMimeFromBytes(bytes, options.fileName),
    bytes,
  );
}

export async function readAttachmentContent(
  store: FileTasksStore,
  attachmentId: string,
): Promise<{ attachment: Attachment; content: Buffer }> {
  const attachment = await store.getAttachment(attachmentId);
  const content = attachment ? await storedBytes(store, attachment) : null;
  if (!attachment || content === null) throw new Error(`Attachment not found: ${attachmentId}`);
  return { attachment, content: Buffer.from(content) };
}

function errorResponse(context: PluginHttpContext, error: unknown): Response {
  if (error instanceof AttachmentRequestError) {
    return context.json({ error: error.message }, error.status);
  }
  if (error instanceof AttachmentReferencedError) {
    return context.json({ error: error.message }, 409);
  }
  if (error instanceof AttachmentCleanupError) {
    return context.json({ error: error.message }, 500);
  }
  throw error;
}

/**
 * Removes an attachment end to end using one shared policy for HTTP, RPC, and
 * CLI callers. Saved-description references are rejected unless the caller
 * explicitly opts into removing them, blob cleanup must succeed before the
 * row is removed, and realtime is published only after every mutation
 * succeeds. A cleanup failure therefore leaves the row and blob reachable for
 * a later retry instead of reporting a false success.
 */
export async function deleteAttachmentById(
  bb: BbPluginApi,
  store: FileTasksStore,
  attachmentId: string,
  options: {
    removeBlobs?: typeof removeAttachmentBlobs;
    removeDescriptionReferences?: boolean;
  } = {},
): Promise<Attachment | null> {
  const attachment = await store.getAttachment(attachmentId);
  if (!attachment) return null;

  const taskId =
    attachment.taskId ??
    (attachment.commentId
      ? (await store.getComment(attachment.commentId))?.taskId
      : undefined);
  const ownerTask = taskId ? await store.getTask(taskId) : undefined;
  let nextDescription: string | undefined;
  if (ownerTask !== undefined && attachmentDownloadUrls(attachment.id).some((url) => ownerTask.description.includes(url))) {
    if (!options.removeDescriptionReferences) {
      throw new AttachmentReferencedError(attachment);
    }
    nextDescription = removeAttachmentDescriptionReferences(
      ownerTask.description,
      attachment.id,
    );
    if (nextDescription === ownerTask.description) {
      throw new AttachmentReferencedError(attachment);
    }
  }

  try {
    await (options.removeBlobs ?? removeAttachmentBlobs)(
      bb,
      store,
      [attachment],
      ownerTask ? store.projectBlobs(ownerTask.projectId) : null,
    );
  } catch (error) {
    throw new AttachmentCleanupError(attachment, error);
  }
  if (ownerTask && nextDescription !== undefined) {
    await store.updateTask(ownerTask.id, { description: nextDescription });
  }
  if (!(await store.deleteAttachment(attachment.id))) return null;
  await publishAttachmentChanged(bb, store, attachment);
  return attachment;
}

export async function publishAttachmentChanged(
  bb: BbPluginApi,
  store: FileTasksStore,
  attachment: Attachment,
): Promise<void> {
  const taskId =
    attachment.taskId ??
    (attachment.commentId
      ? (await store.getComment(attachment.commentId))?.taskId
      : undefined);
  const task = taskId ? await store.getTask(taskId) : undefined;
  if (!task) {
    bb.log.warn(`failed to publish attachment change ${attachment.id}`);
    return;
  }
  bb.realtime.publish("tasks:changed", {
    taskId: task.id,
    projectId: task.projectId,
  });
}

/**
 * Registers exact-match attachment routes. Upload accepts a raw request body
 * and therefore uses token auth; metadata may be supplied through query
 * parameters or x-task-id/x-comment-id/x-file-name/x-mime-type headers.
 */
export function registerAttachments(
  bb: BbPluginApi,
  store: FileTasksStore,
  options: {
    removeBlobs?: typeof removeAttachmentBlobs;
    /** Та же память об окружениях, что у RPC: загрузка из панели треда
     *  обязана попадать в файл задачи его рабочего дерева. */
    callerEnvironments?: CallerEnvironmentCache;
  } = {},
): void {
  const root = pluginDataDirectory(bb);
  storeRoots.set(store, root);
  /** Окружение треда, из которого пришёл запрос; null — доска, область main. */
  const callerEnvironment = async (callerThreadId: string | null) =>
    callerThreadId === null || !options.callerEnvironments
      ? null
      : await options.callerEnvironments.get(callerThreadId);

  bb.http.route(
    "POST",
    UPLOAD_PATH,
    async (context) => {
      try {
        const parameters = attachmentParameters(context);
        const body = await readRequestBody(context.req.raw);
        const environment = await callerEnvironment(parameters.callerThreadId);
        const attachment = await runInCallerScope(environment, () =>
          persistAttachment(
            store,
            parameters.owner,
            parameters.fileName,
            parameters.mime,
            body,
          ),
        );
        await publishAttachmentChanged(bb, store, attachment);
        return context.json(
          {
            attachmentId: attachment.id,
            url: attachmentDownloadUrl(attachment.id),
          },
          201,
        );
      } catch (error) {
        return errorResponse(context, error);
      }
    },
    { auth: "token" },
  );

  bb.http.route("GET", DOWNLOAD_PATH, async (context) => {
    const attachmentId = context.req.query("attachmentId")?.trim();
    // Картинка задачи, которая пока живёт в ветке треда, есть только в его
    // дереве: клиент поверхности треда называет тред в адресе картинки.
    const environment = await callerEnvironment(
      context.req.query(CALLER_THREAD_FIELD) ?? null,
    );
    const found = attachmentId
      ? await runInCallerScope(environment, async () => {
          const attachment = await store.getAttachment(attachmentId);
          return attachment ? { attachment, bytes: await storedBytes(store, attachment) } : undefined;
        }).catch((error: unknown) => {
          if (outOfReach(error)) return "out-of-reach" as const;
          throw error;
        })
      : undefined;
    if (found === "out-of-reach")
      return context.json({ error: "the project's database is out of reach" }, 503);
    if (!found || found.bytes === null)
      return context.json({ error: "attachment not found" }, 404);

    const { attachment, bytes } = found;
    const disposition = isInlineRasterMime(attachment.mime)
      ? "inline"
      : "attachment";
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": attachment.mime,
        "Content-Length": String(attachment.sizeBytes),
        "Content-Disposition": buildContentDisposition(
          disposition,
          attachment.fileName,
        ),
        "X-Content-Type-Options": "nosniff",
      },
    });
  });

  bb.http.route("DELETE", DELETE_PATH, async (context) => {
    const attachmentId = context.req.query("attachmentId")?.trim();
    try {
      const attachment = attachmentId
        ? await deleteAttachmentById(bb, store, attachmentId, {
            removeBlobs: options.removeBlobs,
            removeDescriptionReferences:
              context.req.query("removeDescriptionReferences") === "true",
          })
        : null;
      if (!attachment)
        return context.json({ error: "attachment not found" }, 404);
      return context.json({ deleted: true });
    } catch (error) {
      return errorResponse(context, error);
    }
  });
}
