// @vitest-environment node
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { STAGES, add, report, stagedBrief } from "../core/stages-fixtures";
import type { DecisionBrief } from "../shared/contract";
import { registerApi } from "./api";
import { createStore } from "./store";

const brief: DecisionBrief = {
  ...stagedBrief([report("task", { state: "review", results: [{ label: "spec.md", target: "docs/specs/spec.md" }] }), report("spec", { recommended: true, add: add(4, 8, 1, 30) })], {
    title: "Rename to Flow",
    stages: { list: STAGES.map((stage) => ({ ...stage, name: stage.id })), minButtonWidth: 170 },
  }),
  questions: [{ id: "who", question: "Who executes?", kind: "fork", allowOwn: false, options: [
    { id: "me", action: "Me", recommended: true, description: "I do it.", add: add(0, 0, 0) },
    { id: "agent", action: "Agent", recommended: false, description: "An agent does it.", add: add(2, 4, 1, 10) },
  ] }],
};

const setup = async (location: () => Promise<{ hostId: string; storageRootPath: string }>) => {
  const root = await mkdtemp(join(tmpdir(), "flow-locale-"));
  const { bb, harness } = createFakePluginHost({
    pluginId: "flow",
    sdk: {
      threads: {
        send: async () => ({ delivery: "started" }),
        get: async () => ({ id: "thr_1", projectId: "prj_1", environmentId: "env_1", title: "Thread" }),
        storageLocation: async () => ({ ...(await location()), storageRootPath: root }),
      },
      // Загрузка отвечает именем файла: строке картинок хватает, что путь есть.
      projects: { attachments: { upload: (async (args: { filename: string }) => ({ type: "localImage", path: args.filename, name: args.filename, sizeBytes: 3 })) as never } },
    },
  });
  const store = createStore(bb.storage.kv);
  await store.putBrief(brief);
  registerApi(bb, store, { now: () => "2026-09-15T00:05:00.000Z" });
  return { root, harness };
};

const answer = {
  briefId: brief.id,
  answers: [{ questionId: "who", optionIds: [], own: "see [image 1]" }],
  stages: [{ id: "task", run: false, executor: "self", review: true, accepted: true }],
};

const sentText = (harness: Awaited<ReturnType<typeof setup>>["harness"]): string =>
  (harness.sdk.callsTo("threads.send")[0]![0] as { input: Array<{ text?: string }> }).input[0]!.text ?? "";

describe("язык ответа в тред", () => {
  it("ответ с языком en уходит агенту по-английски целиком: этапы, бюджет, дальше и строка картинок", async () => {
    const { harness } = await setup(async () => ({ hostId: "local", storageRootPath: "" }));
    const images = [{ n: 1, mimeType: "image/png", dataBase64: Buffer.from("png").toString("base64") }];
    expect(await harness.callRpc("answerBrief", { id: brief.id, messageId: "msg_1", answer, locale: "en", images })).toMatchObject({ kind: "accepted" });
    const text = sentText(harness);
    expect(text).toContain(`Brief "${brief.title}" — answer:`);
    expect(text).toContain("Work stages:");
    expect(text).toContain("Budget — forecast");
    expect(text).toContain("Next — ");
    expect(text).toContain("Images: [image 1] — ");
    expect(text).not.toMatch(/[А-Яа-яЁё]/);
  });

  it("снимок прогноза записан на языке ответа", async () => {
    const { harness } = await setup(async () => ({ hostId: "local", storageRootPath: "" }));
    const result = await harness.callRpc("answerBrief", { id: brief.id, messageId: "msg_1", answer, locale: "en" });
    expect(result).toMatchObject({ kind: "accepted", record: { forecast: { lines: expect.arrayContaining([expect.objectContaining({ note: "Self" })]) } } });
  });

  it("ответ без языка — русский, как до выбора языка", async () => {
    const { harness } = await setup(async () => ({ hostId: "local", storageRootPath: "" }));
    await harness.callRpc("answerBrief", { id: brief.id, messageId: "msg_1", answer });
    expect(sentText(harness)).toContain("Этапы работ:");
  });
});

describe("хранилище треда для ссылок результатов", () => {
  it("называет хост и корень хранилища треда", async () => {
    const { root, harness } = await setup(async () => ({ hostId: "host_7", storageRootPath: "" }));
    expect(await harness.callRpc("threadStorage", { threadId: "thr_1" })).toEqual({ kind: "found", hostId: "host_7", storageRootPath: root });
  });

  it("bb не знает треда — хранилища нет, а не ошибка", async () => {
    const { harness } = await setup(async () => {
      throw new Error("thread not found");
    });
    expect(await harness.callRpc("threadStorage", { threadId: "thr_gone" })).toEqual({ kind: "unavailable" });
  });
});
