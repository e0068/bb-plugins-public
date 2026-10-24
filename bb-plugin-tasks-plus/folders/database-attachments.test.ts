// @vitest-environment node
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHranaFake, type HranaFake } from "../test-support/hrana-fake.js";
import { boardByPrefix, tasksHost, type TasksHost } from "../test-support/tasks-host.js";
import { createDbRepo } from "../filesync/db-repo.js";
import { createHranaClient } from "../remote/hrana.js";

/**
 * A file attached to a task of a database board is part of the board: every
 * machine connected to the database opens it, not only the one that uploaded
 * it (BBPL-914).
 */

let hrana: HranaFake;
const hosts: TasksHost[] = [];

beforeEach(() => {
  hrana = createHranaFake();
  vi.stubGlobal("fetch", hrana.fetch);
});
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.harness.dispose();
  vi.unstubAllGlobals();
});

async function machine(name: string) {
  const host = await tasksHost({ machine: name });
  hosts.push(host);
  return host;
}

type Invite = { ok: true; invite: string } | { ok: false };

/** Two machines on the board REM kept in one database, and a task of it. */
async function twoMachines() {
  hrana.addDatabase("board-me.turso.io", "owner-token");
  const a = await machine("Mac mini");
  await a.call("connectDatabase", { url: "libsql://board-me.turso.io", token: "owner-token", name: "Remote", prefix: "REM" });
  const board = (await boardByPrefix(a, "REM"))!;
  const { task } = await a.call<{ task: { id: string } }>("createTask", { projectId: board.id, title: "Glow" });
  const invite = await a.call<Invite>("databaseInvite", { boardId: board.id });
  const b = await machine("MacBook");
  await b.call("connectDatabase", { url: invite.ok ? invite.invite : "" });
  const onB = (await boardByPrefix(b, "REM"))!;
  const { tasks } = await b.call<{ tasks: { id: string }[] }>("listTasks", { projectId: onB.id });
  return { a, b, boardId: board.id, taskId: task.id, taskIdOnB: tasks[0]!.id };
}

/** Waits until the other machine has caught up with the record of the attachment — it is the file that is under test. */
async function recordArrives(host: TasksHost, taskId: string, attachmentId: string): Promise<void> {
  await vi.waitFor(async () => {
    const { attachments } = await host.call<{ attachments: { id: string }[] }>("listAttachments", { taskId });
    expect(attachments.map((attachment) => attachment.id)).toContain(attachmentId);
  }, { timeout: 5000, interval: 100 });
}

async function upload(host: TasksHost, taskId: string, fileName: string, mime: string, bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const query = new URLSearchParams({ taskId, fileName, mime });
  const response = await host.harness.fetchHttp("POST", `/attachments/upload?${query.toString()}`, { body: new Blob([bytes]) });
  expect(response.status).toBe(201);
  return ((await response.json()) as { attachmentId: string }).attachmentId;
}

const download = (host: TasksHost, attachmentId: string) =>
  host.harness.fetchHttp("GET", `/attachments/download?attachmentId=${encodeURIComponent(attachmentId)}`);

/** Where the machine keeps an attachment's file on its own disk. */
function diskCopy(host: TasksHost, attachmentId: string, fileName: string): string {
  const main = host.bb.storage
    .database()
    .prepare<[], { name: string; file: string }>("PRAGMA database_list")
    .all()
    .find((database) => database.name === "main")!;
  return join(dirname(main.file), "blobs", attachmentId, fileName);
}

const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const pngBytes = (size: number): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  for (let index = 8; index < size; index++) bytes[index] = index % 251;
  return bytes;
};

describe("Attachments of a database board", () => {
  it("open on another machine connected to the same database", async () => {
    const { a, b, taskId, taskIdOnB } = await twoMachines();
    const bytes = pngBytes(49_416);
    const attachmentId = await upload(a, taskId, "image.png", "image/png", bytes);

    await recordArrives(b, taskIdOnB, attachmentId);
    const response = await download(b, attachmentId);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it("open on another machine at the 25 MB size limit", async () => {
    const { a, b, taskId, taskIdOnB } = await twoMachines();
    const bytes = pngBytes(25 * 1024 * 1024);
    const attachmentId = await upload(a, taskId, "large.png", "image/png", bytes);

    await recordArrives(b, taskIdOnB, attachmentId);
    const response = await download(b, attachmentId);
    expect(response.status).toBe(200);
    // Compared by digest: an element-by-element match of 25 MB outgrows the test's memory.
    expect(digest(new Uint8Array(await response.arrayBuffer()))).toBe(digest(bytes));
  }, 60_000);

  it("are gone on another machine once deleted, even after it opened them", async () => {
    const { a, b, taskId, taskIdOnB } = await twoMachines();
    const attachmentId = await upload(a, taskId, "image.png", "image/png", pngBytes(1_024));
    await recordArrives(b, taskIdOnB, attachmentId);
    expect((await download(b, attachmentId)).status).toBe(200);

    const deleted = await a.harness.fetchHttp("DELETE", `/attachments/delete?attachmentId=${encodeURIComponent(attachmentId)}`);
    expect(deleted.status).toBe(200);

    expect((await download(a, attachmentId)).status).toBe(404);
    // The other machine learns of the deletion on its next poll, as of any change.
    await vi.waitFor(async () => expect((await download(b, attachmentId)).status).toBe(404), { timeout: 5000, interval: 100 });
    // Nor is a copy left in the database: a fresh link to it reads nothing under the id.
    const fresh = createDbRepo(createHranaClient({ url: "libsql://board-me.turso.io", token: "owner-token", fetch: hrana.fetch }), { url: "libsql://board-me.turso.io" });
    expect(await fresh.blobs.read(attachmentId)).toBeNull();
  });

  it("stay on another machine when one machine drops the project — the tasks stay in the database", async () => {
    const { a, b, boardId, taskId, taskIdOnB } = await twoMachines();
    const bytes = pngBytes(2_048);
    const attachmentId = await upload(a, taskId, "image.png", "image/png", bytes);
    await recordArrives(b, taskIdOnB, attachmentId);

    await a.call("deleteProject", { projectId: boardId, force: true });

    const response = await download(b, attachmentId);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it("open whole on a machine whose copy on disk was cut short", async () => {
    const { a, b, taskId, taskIdOnB } = await twoMachines();
    const bytes = pngBytes(4_096);
    const attachmentId = await upload(a, taskId, "image.png", "image/png", bytes);
    await recordArrives(b, taskIdOnB, attachmentId);
    expect((await download(b, attachmentId)).status).toBe(200);

    // What a copy interrupted mid-write leaves behind.
    await writeFile(diskCopy(b, attachmentId, "image.png"), bytes.subarray(0, 1_000));

    const response = await download(b, attachmentId);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });
});
