// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import type { DecisionBrief } from "../shared/contract";
import { registerApi } from "./api";
import { createStore } from "./store";

/** Текст, который получает агент: все текстовые части реплики подряд. */
const agentText = (input: ReadonlyArray<{ type?: string; text?: string }>): string => input.flatMap((part) => (part.type === "text" ? [part.text ?? ""] : [])).join("\n");


const brief: DecisionBrief = {
  id: "dec_seen",
  threadId: "thr_1",
  title: "Уточнение с картинкой",
  createdAt: "2026-10-10T00:00:00.000Z",
  kind: "clarify",
  questions: [{ id: "ok", question: "Так?", kind: "yesno", allowOwn: false, options: [
    { id: "yes", action: "Да", recommended: true },
    { id: "no", action: "Нет", recommended: false },
  ] }],
};

type Upload = { projectId: string; clientFile: Uint8Array; filename: string; mimeType?: string };
type Read = { projectId: string; path: string };

const stored = (filename: string): string => `attachments/${filename}`;
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", svg: "image/svg+xml", zip: "application/zip" };

/** Хранилище вложений bb в памяти: что загружено, то и читается обратно. */
const setup = async (read?: (args: Read) => Promise<unknown>) => {
  const files = new Map<string, Uint8Array>();
  const { bb, harness } = createFakePluginHost({
    pluginId: "flow",
    sdk: {
      threads: { send: async () => ({ delivery: "started" }), get: async () => ({ id: "thr_1", projectId: "prj_1", environmentId: "env_1", title: "Тред" }) },
      projects: {
        attachments: {
          upload: (async (args: Upload) => {
            files.set(stored(args.filename), args.clientFile);
            return { type: "localImage", path: stored(args.filename), name: args.filename, sizeBytes: args.clientFile.length };
          }) as never,
          read: (read ??
            (async ({ path }: Read) => {
              const bytes = files.get(path);
              if (bytes === undefined) throw new Error("not found");
              return { bytes, mimeType: MIME[path.split(".").pop()!]!, sizeBytes: bytes.length };
            })) as never,
        },
      },
    },
  });
  const store = createStore(bb.storage.kv);
  await store.putBrief(brief);
  registerApi(bb, store, { now: () => "2026-10-10T00:05:00.000Z" });
  return { harness, store };
};

const images = [
  { n: 1, mimeType: "image/png", dataBase64: Buffer.from("first").toString("base64") },
  { n: 2, mimeType: "image/jpeg", dataBase64: Buffer.from("second").toString("base64") },
];

const answer = { briefId: brief.id, answers: [{ questionId: "ok", optionIds: [], own: "кнопка [Изображение 1] и шапка [Изображение 2]" }] };

describe("отвеченный бриф помнит картинки, с которыми ушёл ответ", () => {
  it("запись ответа хранит номер метки и путь вложения каждой картинки", async () => {
    const { harness, store } = await setup();
    await harness.callRpc("answerBrief", { id: brief.id, messageId: "msg_1", answer, images });
    expect((await store.getAnswer(brief.id))?.images).toEqual([
      { n: 1, path: stored("decision-dec_seen-1.png") },
      { n: 2, path: stored("decision-dec_seen-2.jpg") },
    ]);
  });

  it("ответ без картинок пишется без поля картинок", async () => {
    const { harness, store } = await setup();
    await harness.callRpc("answerBrief", { id: brief.id, messageId: "msg_1", answer: { ...answer, answers: [{ questionId: "ok", optionIds: ["yes"] }] } });
    expect((await store.getAnswer(brief.id))?.images).toBeUndefined();
  });

  it("картинки отвеченного брифа читаются обратно теми же байтами и под теми же номерами", async () => {
    const { harness } = await setup();
    await harness.callRpc("answerBrief", { id: brief.id, messageId: "msg_1", answer, images });
    expect(await harness.callRpc("answerImages", { id: brief.id })).toEqual({ kind: "found", images: [
      { n: 1, mimeType: "image/png", dataBase64: images[0]!.dataBase64 },
      { n: 2, mimeType: "image/jpeg", dataBase64: images[1]!.dataBase64 },
    ] });
    expect(harness.sdk.callsTo("projects.attachments.read").map(([args]) => (args as Read).projectId)).toEqual(["prj_1", "prj_1"]);
  });

  it("картинка, которую bb не отдал, выпадает, остальные приходят", async () => {
    const { harness } = await setup(async ({ path }) => {
      if (path.endsWith("-1.png")) throw new Error("gone");
      return { bytes: Buffer.from("second"), mimeType: "image/jpeg", sizeBytes: 6 };
    });
    await harness.callRpc("answerBrief", { id: brief.id, messageId: "msg_1", answer, images });
    expect(await harness.callRpc("answerImages", { id: brief.id })).toEqual({ kind: "found", images: [{ n: 2, mimeType: "image/jpeg", dataBase64: images[1]!.dataBase64 }] });
  });

  it("черновик с прежней меткой «картинка» уносит свои картинки", async () => {
    const { harness, store } = await setup();
    await harness.callRpc("answerBrief", { id: brief.id, messageId: "msg_1", answer: { ...answer, answers: [{ questionId: "ok", optionIds: [], own: "[картинка 1] и [картинка 2]" }] }, images });
    expect((await store.getAnswer(brief.id))?.images?.map(({ n }) => n)).toEqual([1, 2]);
  });

  it("у брифа без ответа картинок нет", async () => {
    const { harness } = await setup();
    expect(await harness.callRpc("answerImages", { id: brief.id })).toEqual({ kind: "not_found" });
    expect(await harness.callRpc("answerImages", { id: "dec_missing" })).toEqual({ kind: "not_found" });
  });
});

describe("svg и архив уходят агенту файлами", () => {
  const files = [
    { n: 1, mimeType: "image/png", dataBase64: Buffer.from("png").toString("base64") },
    { n: 2, mimeType: "image/svg+xml", dataBase64: Buffer.from("<svg/>").toString("base64"), name: "frame.svg" },
    { n: 3, mimeType: "application/zip", dataBase64: Buffer.from("PK").toString("base64"), name: "Frame 456346.svg.zip" },
  ];
  const mixed = { briefId: brief.id, answers: [{ questionId: "ok", optionIds: [], own: "[Изображение 1] [Изображение 2] [файл 3]" }] };

  it("файл ложится вложением под своим именем, картинка — под номером", async () => {
    const { harness } = await setup();
    await harness.callRpc("answerBrief", { id: brief.id, messageId: "msg_1", answer: mixed, images: files });
    expect(harness.sdk.callsTo("projects.attachments.upload").map(([args]) => (args as Upload).filename)).toEqual([
      "decision-dec_seen-1.png",
      "decision-dec_seen-2-frame.svg",
      "decision-dec_seen-3-Frame_456346.svg.zip",
    ]);
  });

  it("реплика несёт картинку картинкой, а svg и архив — файлами с именем и типом", async () => {
    const { harness } = await setup();
    await harness.callRpc("answerBrief", { id: brief.id, messageId: "msg_1", answer: mixed, images: files });
    const input = (harness.sdk.callsTo("threads.send")[0]![0] as { input: Array<Record<string, unknown>> }).input;
    expect(input.filter((part) => part.type !== "text").map(({ type, name, mimeType }) => ({ type, name, mimeType }))).toEqual([
      { type: "localImage", name: undefined, mimeType: undefined },
      { type: "localFile", name: "frame.svg", mimeType: "image/svg+xml" },
      { type: "localFile", name: "Frame 456346.svg.zip", mimeType: "application/zip" },
    ]);
    expect(agentText(input)).toContain(`[файл 3] — ${stored("decision-dec_seen-3-Frame_456346.svg.zip")}`);
  });

  it("отвеченный бриф получает файл обратно с его именем", async () => {
    const { harness } = await setup();
    await harness.callRpc("answerBrief", { id: brief.id, messageId: "msg_1", answer: mixed, images: files });
    const result = (await harness.callRpc("answerImages", { id: brief.id })) as { images: Array<{ n: number; name?: string }> };
    expect(result.images.map(({ n, name }) => ({ n, name }))).toEqual([{ n: 1, name: undefined }, { n: 2, name: "frame.svg" }, { n: 3, name: "Frame 456346.svg.zip" }]);
  });
});
