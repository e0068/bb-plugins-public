import { describe, expect, it } from "vitest";
import { folderDomainErrorSchema, foldersRpcContract, syncedFolderSchema } from "./contract.js";

const folderRow = {
  projectId: "01HZZZZZZZZZZZZZZZZZZZZZP1",
  projectName: "Tasks",
  projectPrefix: "TSK",
  taskCount: 3,
  tasksFolder: "docs/tasks",
  linkedBbProjectId: "proj_x",
  linkedBbProjectName: "Repo",
  repoPath: "/repo",
  source: { kind: "folder" },
};

const databaseRow = {
  ...folderRow,
  tasksFolder: null,
  linkedBbProjectId: null,
  linkedBbProjectName: null,
  repoPath: null,
  source: { kind: "database", url: "libsql://board-me.turso.io", state: "offline", lastSyncAt: "2026-09-30T12:00:00.000Z" },
};

type Contract = Record<string, { input: { safeParse(value: unknown): { success: boolean } }; output: { safeParse(value: unknown): { success: boolean } } }>;
const contract = foldersRpcContract as unknown as Contract;
const method = (name: string) => {
  expect(contract[name], `${name} is part of the folders contract`).toBeDefined();
  return contract[name]!;
};

describe("a connected source is a folder or a database", () => {
  it("lists a folder row and a database row", () => {
    expect(syncedFolderSchema.safeParse(folderRow).success).toBe(true);
    expect(syncedFolderSchema.safeParse(databaseRow).success).toBe(true);
  });

  it("never lets a token into a row", () => {
    expect(syncedFolderSchema.safeParse({ ...databaseRow, source: { ...databaseRow.source, token: "t" } }).success).toBe(false);
  });
});

describe("the methods that connect a board to a database", () => {
  it("createDatabase answers with the address only, never a token", () => {
    const { input, output } = method("createDatabase");
    expect(input.safeParse({ prefix: "TSK" }).success).toBe(true);
    expect(input.safeParse({ prefix: "TSK", tursoApiToken: "account" }).success).toBe(true);
    expect(output.safeParse({ ok: true, url: "libsql://bb-tasks-tsk-me.turso.io" }).success).toBe(true);
    expect(output.safeParse({ ok: true, url: "libsql://bb-tasks-tsk-me.turso.io", token: "jwt" }).success).toBe(false);
  });

  it("listTursoDatabases answers names and addresses", () => {
    const { output } = method("listTursoDatabases");
    expect(output.safeParse({ ok: true, databases: [{ name: "bb-tasks-tsk", url: "libsql://bb-tasks-tsk-me.turso.io" }] }).success).toBe(true);
  });

  it("connectDatabase takes an address, and optionally a token, a folder board to move, a name and a prefix", () => {
    const { input, output } = method("connectDatabase");
    expect(input.safeParse({ url: "libsql://board-me.turso.io" }).success).toBe(true);
    expect(input.safeParse({ url: "libsql://board-me.turso.io", token: "t", moveFromBoardId: "01HZZZZZZZZZZZZZZZZZZZZZP1", name: "Tasks", prefix: "TSK" }).success).toBe(true);
    expect(output.safeParse({ ok: true }).success).toBe(true);
  });

  it("hasTursoApiToken says only whether one is saved, and retryDatabase takes a board", () => {
    expect(method("hasTursoApiToken").output.safeParse({ saved: true }).success).toBe(true);
    expect(method("hasTursoApiToken").output.safeParse({ saved: true, token: "t" }).success).toBe(false);
    expect(method("retryDatabase").input.safeParse({ boardId: "01HZZZZZZZZZZZZZZZZZZZZZP1" }).success).toBe(true);
  });

  it("names every way connecting can fail", () => {
    for (const code of ["database_unreachable", "database_auth_failed", "database_not_empty", "turso_token_required", "turso_api_failed"]) {
      expect(folderDomainErrorSchema.safeParse({ code, message: "m" }).success, code).toBe(true);
    }
  });
});

describe("the method that mints a Turso API token through the CLI", () => {
  it("takes nothing and answers a token or why the CLI could not mint one", () => {
    const { input, output } = method("generateTursoApiToken");
    expect(input.safeParse(null).success).toBe(true);
    expect(output.safeParse({ ok: true, token: "jwt" }).success).toBe(true);
    for (const reason of ["cli_missing", "not_logged_in", "failed"]) {
      expect(output.safeParse({ ok: false, reason, message: "m" }).success, reason).toBe(true);
    }
    expect(output.safeParse({ ok: false, reason: "offline", message: "m" }).success).toBe(false);
    expect(output.safeParse({ ok: true, token: "jwt", extra: 1 }).success).toBe(false);
  });
});
