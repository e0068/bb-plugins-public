// @vitest-environment node
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { silentTurnEntry } from "../core/center-notice";
import { createSilentTurns, readTextFromDisk } from "./silent-turn";

const NOW = 1792680530000;
const LIMIT = "429 You've reached your 5-hour usage limit.";
const failed = `{"type":"turn.ended","agentId":"main","turnId":5,"reason":"failed","error":{"message":"${LIMIT}"},"time":${NOW - 5_000}}`;
const ok = `{"type":"turn.ended","agentId":"main","turnId":6,"reason":"completed","time":${NOW - 1_000}}`;

/** Папка Kimi в памяти: путь → текст. */
const fakeKimi = (files: Record<string, string>) =>
  createSilentTurns({ kimiHome: "/kimi", now: () => NOW, readText: async (path) => files[path] ?? null });

const index = `{"sessionId":"s1","sessionDir":"/kimi/sessions/s1","workDir":"/wt"}`;
const thread = { providerId: "acp-kimi", workDir: "/wt" };

describe("немые ходы тредов", () => {
  it("провал хода Kimi ставит плашку с причиной", async () => {
    const turns = fakeKimi({ "/kimi/session_index.jsonl": index, "/kimi/sessions/s1/agents/main/wire.jsonl": failed });
    expect(await turns.check("t1", thread)).toEqual({ kind: "quota", message: LIMIT, at: NOW - 5_000 });
    expect(turns.get("t1")?.kind).toBe("quota");
  });

  it("следующий ход снимает плашку, нормальный ответ её не возвращает", async () => {
    const files: Record<string, string> = { "/kimi/session_index.jsonl": index, "/kimi/sessions/s1/agents/main/wire.jsonl": failed };
    const turns = fakeKimi(files);
    await turns.check("t1", thread);
    turns.clear("t1");
    expect(turns.get("t1")).toBeNull();
    files["/kimi/sessions/s1/agents/main/wire.jsonl"] = `${failed}\n${ok}`;
    expect(await turns.check("t1", thread)).toBeNull();
    expect(turns.get("t1")).toBeNull();
  });

  it("другой провайдер, тред без папки и Kimi без журнала — плашки нет", async () => {
    const turns = fakeKimi({ "/kimi/session_index.jsonl": index, "/kimi/sessions/s1/agents/main/wire.jsonl": failed });
    expect(await turns.check("t1", { providerId: "claude-code", workDir: "/wt" })).toBeNull();
    expect(await turns.check("t1", { providerId: "acp-kimi", workDir: null })).toBeNull();
    expect(await fakeKimi({}).check("t1", thread)).toBeNull();
  });

  it("сломанное чтение журнала не ставит ложную плашку", async () => {
    const turns = createSilentTurns({ kimiHome: "/kimi", now: () => NOW, readText: async () => Promise.reject(new Error("EACCES")) });
    expect(await turns.check("t1", thread)).toBeNull();
  });

  it("хвост файла читается последними байтами", async () => {
    const dir = await mkdtemp(join(tmpdir(), "silent-turn-"));
    const path = join(dir, "wire.jsonl");
    await writeFile(path, "0123456789");
    expect(await readTextFromDisk(path, 4)).toBe("6789");
    expect(await readTextFromDisk(path)).toBe("0123456789");
    expect(await readTextFromDisk(join(dir, "нет.jsonl"))).toBeNull();
  });
});

describe("запись центра уведомлений", () => {
  it("немой ход — красная запись, всплывает тостом, а не «ход закончен»", () => {
    const entry = silentTurnEntry({ threadId: "t1", threadTitle: "Kimi", silent: { kind: "quota", message: LIMIT, at: 1 } });
    expect(entry).toMatchObject({ kind: "turn-silent", tone: "error", toastByDefault: true, threadId: "t1" });
    expect(entry.title).toBe("Агент закрыл ход без ответа — лимит подписки исчерпан");
    expect(silentTurnEntry({ threadId: "t1", threadTitle: null, silent: { kind: "error", message: null, at: 1 } }).title).toContain("причина неизвестна");
  });
});
