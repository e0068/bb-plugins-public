// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import type { DecisionAnswer, DecisionBrief } from "../shared/contract";
import { createJournalDirStore } from "./dir-settings";
import { writeDecision } from "./journal-writer";

const brief: DecisionBrief = {
  id: "dec_b",
  threadId: "thr_1",
  title: "Как вести работу",
  createdAt: "2026-09-12T12:00:00.000Z",
  kind: "brief",
  questions: [
    {
      id: "priority",
      question: "Приоритет?",
      kind: "choice",
      allowOwn: false,
      options: [
        { id: "speed", action: "Скорость", recommended: false },
        { id: "quality", action: "Качество", recommended: true },
      ],
    },
  ],
};

const answer: DecisionAnswer = {
  briefId: "dec_b",
  answers: [{ questionId: "priority", optionIds: ["speed"] }],
};

const args = { brief, answer, decidedAt: "2026-09-15T12:00:00.000Z" };

type Write = (args: { path: string }) => Promise<unknown>;

const written = { outcome: "written" as const, sha256: "abc", sizeBytes: 10 };

/**
 * Фейк с контрактом хоста: демон bb проверяет `path` на абсолютность до всякой записи и
 * на относительный отвечает 400. Двойник мягче настоящего хоста однажды уже закрепил
 * поломку зелёным тестом — поэтому строгость живёт здесь, а не в теле каждого теста.
 */
const hostWrite = (write: Write): Write => async (args) => {
  if (!args.path.startsWith("/")) throw new Error("HTTP 400: Path must be absolute");
  return write(args);
};

const setup = (overrides: { threads?: object; environments?: object; files?: { write?: Write } } = {}) => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "flow",
    sdk: {
      threads: { get: async () => ({ projectId: "proj_1", environmentId: "env_1" }), ...overrides.threads },
      environments: { get: async () => ({ path: "/work/tree", hostId: "host_1" }), ...overrides.environments },
      files: { write: hostWrite(overrides.files?.write ?? (async () => written)) },
    },
  });
  return { bb, harness };
};

describe("writeDecision", () => {
  it("путь не настроен — skipped not_configured, файл не пишется", async () => {
    const { bb, harness } = setup();
    const dirs = createJournalDirStore(bb.storage.kv);
    expect(await writeDecision(bb, dirs, args)).toEqual({ kind: "skipped", reason: "not_configured" });
    expect(harness.sdk.callsTo("files.write")).toHaveLength(0);
  });

  it("у треда нет environmentId — skipped no_environment", async () => {
    const { bb } = setup({ threads: { get: async () => ({ projectId: "proj_1", environmentId: null }) } });
    const dirs = createJournalDirStore(bb.storage.kv);
    await dirs.set("proj_1", "docs/decisions");
    expect(await writeDecision(bb, dirs, args)).toEqual({ kind: "skipped", reason: "no_environment" });
  });

  it("у окружения нет пути (ещё не готово) — skipped no_environment", async () => {
    const { bb } = setup({ environments: { get: async () => ({ path: null, hostId: "host_1" }) } });
    const dirs = createJournalDirStore(bb.storage.kv);
    await dirs.set("proj_1", "docs/decisions");
    expect(await writeDecision(bb, dirs, args)).toEqual({ kind: "skipped", reason: "no_environment" });
  });

  it("путь настроен, дерево есть — пишет файл по имени из заголовка брифа", async () => {
    const { bb, harness } = setup();
    const dirs = createJournalDirStore(bb.storage.kv);
    await dirs.set("proj_1", "docs/decisions");
    expect(await writeDecision(bb, dirs, args)).toEqual({ kind: "written", path: "docs/decisions/kak-vesti-rabotu.md" });
    const [call] = harness.sdk.callsTo("files.write");
    expect(call[0]).toMatchObject({ hostId: "host_1", rootPath: "/work/tree", path: "/work/tree/docs/decisions/kak-vesti-rabotu.md", expectedSha256: null, createParents: true });
  });

  it("вложенный путь из настроек уходит хосту целиком", async () => {
    const { bb, harness } = setup();
    const dirs = createJournalDirStore(bb.storage.kv);
    await dirs.set("proj_1", "docs/flows/2026");
    expect(await writeDecision(bb, dirs, args)).toEqual({ kind: "written", path: "docs/flows/2026/kak-vesti-rabotu.md" });
    const [call] = harness.sdk.callsTo("files.write");
    expect(call[0]).toMatchObject({ path: "/work/tree/docs/flows/2026/kak-vesti-rabotu.md", createParents: true });
  });

  it("имя занято (conflict) — разводит суффиксом", async () => {
    let calls = 0;
    const { bb, harness } = setup({
      files: {
        write: async () => {
          calls += 1;
          return calls === 1 ? { outcome: "conflict" as const, currentSha256: "x" } : written;
        },
      },
    });
    const dirs = createJournalDirStore(bb.storage.kv);
    await dirs.set("proj_1", "docs/decisions");
    expect(await writeDecision(bb, dirs, args)).toEqual({ kind: "written", path: "docs/decisions/kak-vesti-rabotu-2.md" });
    expect(harness.sdk.callsTo("files.write")).toHaveLength(2);
  });

  it("сбой sdk — failed, не бросает, и попадает в лог плагина", async () => {
    const { bb, harness } = setup({ files: { write: async () => { throw new Error("host unreachable"); } } });
    const dirs = createJournalDirStore(bb.storage.kv);
    await dirs.set("proj_1", "docs/decisions");
    expect(await writeDecision(bb, dirs, args)).toEqual({ kind: "failed", error: "host unreachable" });
    expect(harness.logEntries).toContainEqual({ level: "warn", message: expect.stringContaining("host unreachable") });
  });

  it("имя занято на каждой попытке — failed после предела, не зацикливается", async () => {
    const { bb, harness } = setup({ files: { write: async () => ({ outcome: "conflict" as const, currentSha256: "x" }) } });
    const dirs = createJournalDirStore(bb.storage.kv);
    await dirs.set("proj_1", "docs/decisions");
    expect(await writeDecision(bb, dirs, args)).toEqual({ kind: "failed", error: "name collision limit reached" });
    expect(harness.sdk.callsTo("files.write")).toHaveLength(30);
  });

  it("locale брифа — то же тело, что и в реплике агенту", async () => {
    const { bb, harness } = setup();
    const dirs = createJournalDirStore(bb.storage.kv);
    await dirs.set("proj_1", "docs/decisions");
    await writeDecision(bb, dirs, { ...args, locale: "en" });
    const [call] = harness.sdk.callsTo("files.write");
    expect(call[0]).toMatchObject({ content: expect.stringContaining('Brief "Как вести работу" — answer:') });
  });
});
