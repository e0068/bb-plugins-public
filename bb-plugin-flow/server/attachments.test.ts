// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import type { DecisionAnswer, DecisionBrief } from "../shared/contract";
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

const setup = async (
  upload: (args: Upload) => Promise<unknown> = async (args) => ({ type: "localImage", path: stored(args.filename), name: args.filename, sizeBytes: args.clientFile.length }),
  answered: DecisionBrief = brief,
) => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "flow",
    sdk: {
      threads: { send: async () => ({ delivery: "started" }), get: async () => ({ id: "thr_1", projectId: "prj_1", environmentId: "env_1", title: "Тред" }) },
      // Виджет шлёт байты, поэтому загрузка всегда получает Uint8Array с именем — узкий тип стаба это и записывает.
      projects: { attachments: { upload: upload as never } },
    },
  });
  const store = createStore(bb.storage.kv);
  await store.putBrief(answered);
  registerApi(bb, store, { now: () => "2026-09-15T00:05:00.000Z" });
  const reply = () => harness.sdk.callsTo("threads.send")[0]![0] as { input: Array<{ type: string; path?: string; text?: string }> };
  return { harness, store, reply };
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

  it("ответ без картинок проект треда не спрашивает и ничего не загружает", async () => {
    const { harness } = await setup();
    await harness.callRpc("answerBrief", { id: brief.id, messageId: "msg_1", answer });
    expect(harness.sdk.callsTo("projects.attachments.upload")).toEqual([]);
    expect(harness.sdk.callsTo("threads.get")).toEqual([]);
  });
});

const demo: DecisionBrief = {
  id: "dec_demo",
  threadId: "thr_1",
  title: "Демонстрация",
  createdAt: "2026-10-01T00:00:00.000Z",
  kind: "brief",
  outcome: { stage: "demo", final: true, done: ["Сделано"], pending: [], results: [{ label: "a.md", target: "a.md" }] },
  questions: [],
};
const pngs = [
  { n: 1, mimeType: "image/png", dataBase64: Buffer.from("first").toString("base64") },
  { n: 2, mimeType: "image/png", dataBase64: Buffer.from("second").toString("base64") },
];
const longNote = `[картинка 1] Не совсем понимаю, зачем эти настройки. ${"Подробности замечания. ".repeat(60)}\n\n[картинка 2] Подсказка обрезается.`;
const comment: DecisionAnswer = { briefId: demo.id, answers: [], outcome: { accepted: false, note: longNote } };
const uploaded = async (args: Upload) => ({ type: "localImage", path: stored(args.filename), name: args.filename });

describe("картинки комментария к демонстрации", () => {
  it("две картинки при длинном тексте загружаются обе, и реплика перечисляет имена обеих", async () => {
    const { harness, reply } = await setup(uploaded, demo);
    expect(await harness.callRpc("answerBrief", { id: demo.id, messageId: "m", answer: comment, images: pngs })).toMatchObject({ kind: "accepted" });
    const first = stored("decision-dec_demo-1.png");
    const second = stored("decision-dec_demo-2.png");
    const { input } = reply();
    expect(input.slice(1).map((part) => part.path)).toEqual([first, second]);
    expect(input[0]!.text).toContain(`[картинка 1] — ${first}; [картинка 2] — ${second}`);
    expect(input[0]!.text).not.toContain("Картинки не сохранены");
  });

  it("сбой загрузки одной картинки не отклоняет ответ: вторая сохранена, сбойная названа отдельной строкой", async () => {
    const { harness, store, reply } = await setup(async (args) => {
      if (args.filename.includes("-1.")) throw new Error("upload failed");
      return uploaded(args);
    }, demo);
    expect(await harness.callRpc("answerBrief", { id: demo.id, messageId: "m", answer: comment, images: pngs })).toMatchObject({ kind: "accepted" });
    expect(await store.getAnswer(demo.id)).not.toBeNull();
    const { input } = reply();
    expect(input.slice(1).map((part) => part.path)).toEqual([stored("decision-dec_demo-2.png")]);
    expect(input[0]!.text).toContain(`\nКартинки не сохранены: [картинка 1]`);
  });

  it("метки в тексте без пришедших картинок называются несохранёнными, и реплика агенту уходит", async () => {
    const { harness, reply } = await setup(uploaded, demo);
    await harness.callRpc("answerBrief", { id: demo.id, messageId: "m", answer: { ...comment, outcome: { accepted: true, note: "[картинка 1] и [картинка 2]" } } });
    expect(harness.sdk.callsTo("projects.attachments.upload")).toEqual([]);
    expect(reply().input[0]!.text).toContain(`\nКартинки не сохранены: [картинка 1], [картинка 2]`);
  });

  it("английская метка без картинки называется по-английски", async () => {
    const { harness, reply } = await setup(uploaded, demo);
    await harness.callRpc("answerBrief", { id: demo.id, messageId: "m", locale: "en", answer: { ...comment, outcome: { accepted: false, note: "see [image 3]" } } });
    expect(reply().input[0]!.text).toContain(`\nImages not saved: [image 3]`);
  });

  it("метка в тексте брифа от агента не считается картинкой владельца", async () => {
    const quoting = { ...demo, title: "Демонстрация — что делать с [картинка 1]" };
    const { harness, reply } = await setup(uploaded, quoting);
    await harness.callRpc("answerBrief", { id: demo.id, messageId: "m", answer: { ...comment, outcome: { accepted: false, note: "поправь заголовок" } } });
    expect(reply().input[0]!.text).not.toContain("Картинки не сохранены");
  });
});

describe("картинка, метку которой стёрли", () => {
  it("не грузится и не называется агенту: ушла только картинка с меткой в словах владельца", async () => {
    const { harness, reply } = await setup(uploaded, demo);
    const note = { ...comment, outcome: { accepted: false, note: "[картинка 2] Подсказка обрезается." } };
    expect(await harness.callRpc("answerBrief", { id: demo.id, messageId: "m", answer: note, images: pngs })).toMatchObject({ kind: "accepted" });
    expect(harness.sdk.callsTo("projects.attachments.upload").map(([args]) => (args as Upload).filename)).toEqual(["decision-dec_demo-2.png"]);
    expect(reply().input[0]!.text).not.toContain("[картинка 1]");
  });
});
