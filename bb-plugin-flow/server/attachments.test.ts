// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import type { DecisionBrief } from "../shared/contract";
import { registerApi } from "./api";
import { createStore } from "./store";

const brief: DecisionBrief = {
  id: "dec_img",
  threadId: "thr_1",
  title: "Уточнение с картинкой",
  createdAt: "2026-09-15T00:00:00.000Z",
  kind: "clarify",
  questions: [{ id: "ok", question: "Так?", kind: "yesno", allowOwn: false, options: [
    { id: "yes", action: "Да", recommended: true },
    { id: "no", action: "Нет", recommended: false },
  ] }],
};

type Upload = { projectId: string; clientFile: Uint8Array; filename: string; mimeType?: string };

/** Хранилище вложений bb: имя сохраняется с хвостом, как у настоящей загрузки. */
const stored = (filename: string): string => filename.replace(/(\.\w+)$/, "-1790000000000-abc123$1");

const setup = async (upload: (args: Upload) => Promise<unknown> = async (args) => ({ type: "localImage", path: stored(args.filename), name: args.filename, sizeBytes: args.clientFile.length })) => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "flow",
    sdk: {
      threads: { send: async () => ({ delivery: "started" }), get: async () => ({ id: "thr_1", projectId: "prj_1", environmentId: "env_1", title: "Тред" }) },
      // Виджет шлёт байты, поэтому загрузка всегда получает Uint8Array с именем — узкий тип стаба это и записывает.
      projects: { attachments: { upload: upload as never } },
    },
  });
  const store = createStore(bb.storage.kv);
  await store.putBrief(brief);
  registerApi(bb, store, { now: () => "2026-09-15T00:05:00.000Z" });
  return { harness, store };
};

const images = [
  { n: 1, mimeType: "image/png", dataBase64: Buffer.from("first").toString("base64") },
  { n: 3, mimeType: "image/jpeg", dataBase64: Buffer.from("third").toString("base64") },
];

const answer = { briefId: brief.id, answers: [{ questionId: "ok", optionIds: [], own: "смотри [картинка 1] и [картинка 3]" }] };

describe("картинки ответа — вложения проекта треда", () => {
  it("картинка загружается в проект треда под номером своей метки, с байтами и типом из виджета", async () => {
    const { harness } = await setup();
    expect(await harness.callRpc("answerBrief", { id: brief.id, messageId: "msg_1", answer, images })).toMatchObject({ kind: "accepted" });
    const uploads = harness.sdk.callsTo("projects.attachments.upload").map(([args]) => args as Upload);
    expect(uploads.map(({ projectId, filename, mimeType }) => ({ projectId, filename, mimeType }))).toEqual([
      { projectId: "prj_1", filename: "decision-dec_img-1.png", mimeType: "image/png" },
      { projectId: "prj_1", filename: "decision-dec_img-3.jpg", mimeType: "image/jpeg" },
    ]);
    expect(uploads.map(({ clientFile }) => Buffer.from(clientFile).toString())).toEqual(["first", "third"]);
  });

  it("реплика несёт после текста пути, которые вернула загрузка, и связывает с ними метки", async () => {
    const { harness } = await setup();
    await harness.callRpc("answerBrief", { id: brief.id, messageId: "msg_1", answer, images });
    const input = (harness.sdk.callsTo("threads.send")[0]![0] as { input: Array<{ type: string; path?: string; text?: string }> }).input;
    const first = stored("decision-dec_img-1.png");
    const third = stored("decision-dec_img-3.jpg");
    expect(input.map((part) => part.type)).toEqual(["text", "localImage", "localImage"]);
    expect(input.slice(1).map((part) => part.path)).toEqual([first, third]);
    expect(input[0]!.text).toContain(`[картинка 1] — ${first}`);
    expect(input[0]!.text).toContain(`[картинка 3] — ${third}`);
  });

  it("загрузка не удалась — ответ не принят и не записан, повтор из виджета доходит", async () => {
    let fail = true;
    const { harness, store } = await setup(async (args) => {
      if (fail) throw new Error("upload failed");
      return { type: "localImage", path: stored(args.filename), name: args.filename, sizeBytes: args.clientFile.length };
    });
    await expect(harness.callRpc("answerBrief", { id: brief.id, messageId: "msg_1", answer, images })).rejects.toThrow("upload failed");
    expect(await store.getAnswer(brief.id)).toBeNull();
    expect(harness.sdk.callsTo("threads.send")).toEqual([]);
    fail = false;
    expect(await harness.callRpc("answerBrief", { id: brief.id, messageId: "msg_1", answer, images })).toMatchObject({ kind: "accepted" });
  });

  it("ответ без картинок проект треда не спрашивает и ничего не загружает", async () => {
    const { harness } = await setup();
    await harness.callRpc("answerBrief", { id: brief.id, messageId: "msg_1", answer });
    expect(harness.sdk.callsTo("projects.attachments.upload")).toEqual([]);
    expect(harness.sdk.callsTo("threads.get")).toEqual([]);
  });
});
