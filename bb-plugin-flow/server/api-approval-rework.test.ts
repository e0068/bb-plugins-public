// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { CHECKLIST_TOOL } from "../core/checklist";
import { builtinStage } from "../lib/stage-constants";
import type { DecisionBrief } from "../shared/contract";
import { registerApi } from "./api";
import { createStore } from "./store";

// Владелец оставил комментарии и картинки в виджетах над Утверждением и отправил его: что бы он ни нажал, агент их получает.

const T = "2026-10-29T10:00:00.000Z";
const THREAD = "thr_1";

const stages = { list: [builtinStage("questions", []), builtinStage("demo", []), builtinStage("approve", [])], minButtonWidth: 160 };
const questions: DecisionBrief = {
  id: "Q",
  threadId: THREAD,
  title: "Вопросы",
  createdAt: T,
  kind: "brief",
  settle: "approval",
  questions: [{ id: "go", kind: "choice", question: "Как делаем?", allowOwn: false, options: [{ id: "a", action: "Просто", recommended: true }, { id: "b", action: "Сложно", recommended: false }] }],
};
const outcome = (stage: "demo" | "approve") => ({ stage, final: false, next: "Дальше", done: ["Сделано"], pending: [], results: [{ label: "a.md", target: "a.md" }] });
const demo: DecisionBrief = { id: "D", threadId: THREAD, title: "Демонстрация", createdAt: T, kind: "brief", questions: [], stages, settle: "approval", outcome: outcome("demo") };
const approval: DecisionBrief = { id: "A", threadId: THREAD, title: "Утверждение", createdAt: T, kind: "brief", questions: [], stages, outcome: outcome("approve") };

const rework = (note: string) => ({ briefId: "A", answers: [], outcome: { accepted: false, note } });
const proceed = { briefId: "A", answers: [], outcome: { accepted: true } };
const picked = (optionId: string, note?: string) => ({ briefId: "Q", answers: [{ questionId: "go", optionIds: [optionId] }], ...(note === undefined ? {} : { note }) });
const image = (n: number, bytes: string) => ({ n, mimeType: "image/png", dataBase64: Buffer.from(bytes).toString("base64") });

type Sent = { text: string; images: string[] };

const host = async () => {
  const sent: Sent[] = [];
  const uploaded: Array<{ filename: string; bytes: string }> = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "flow",
    sdk: {
      threads: {
        get: async () => ({ id: THREAD, projectId: "prj_1", environmentId: "env_1", title: "Тред" }),
        send: async (args) => (
          sent.push({
            text: args.input.map((part) => ("text" in part ? part.text : "")).join("\n"),
            images: args.input.flatMap((part) => (part.type === "localImage" ? [part.path] : [])),
          }),
          { delivery: "started" }
        ),
      },
      projects: {
        attachments: {
          upload: (async (args: { clientFile: Uint8Array; filename: string }) => {
            uploaded.push({ filename: args.filename, bytes: Buffer.from(args.clientFile).toString() });
            return { type: "localImage", path: `attachments/${args.filename}`, name: args.filename, sizeBytes: args.clientFile.length };
          }) as never,
        },
      },
    },
  });
  const store = createStore(bb.storage.kv);
  for (const brief of [questions, demo, approval]) await store.putBrief(brief);
  await store.putThreadGroup(THREAD, { ids: ["Q", "D", "A"], lastApprove: true, folded: false });
  await store.putApprovalGroup("A", ["Q", "D", "A"]);
  registerApi(bb, store, { now: () => T });
  const call = (method: string, input: unknown) => harness.callRpc(method as never, input as never) as Promise<Record<string, unknown>>;
  return { store, call, sent, uploaded };
};

describe("«на доработку» несёт агенту комментарии и ответы виджетов группы", () => {
  it("комментарий Демонстрации и ответ Вопросов — в реплике агенту рядом с комментарием Утверждения", async () => {
    const { call, sent } = await host();
    await call("answerBrief", { id: "A", answer: rework("Доработай по комментариям"), messageId: "m", group: [{ id: "Q", answer: picked("b") }, { id: "D", note: "кнопка слишком яркая" }] });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain("Доработай по комментариям");
    expect(sent[0]!.text).toContain("Комментарий к «Демонстрация»: кнопка слишком яркая");
    expect(sent[0]!.text).toContain("Как делаем?");
    expect(sent[0]!.text).toContain("Сложно");
  });

  it("агент не слышит, что ответы владельца «в силе» без самих ответов", async () => {
    const { call, sent } = await host();
    await call("answerBrief", { id: "A", answer: rework("Доработай"), messageId: "m", group: [{ id: "D", note: "шрифт мельче" }, { id: "Q", answer: picked("a") }] });
    expect(sent[0]!.text).not.toContain("остальные его ответы тоже в силе");
  });

  it("комментарии к виджетам — чек-лист под ответом Утверждения, агенту — правило доработки, а не «утверждение в силе»", async () => {
    const { call, store, sent } = await host();
    await call("answerBrief", { id: "A", answer: rework("Доработай"), messageId: "m", group: [{ id: "Q", answer: picked("a", "без лишних файлов") }, { id: "D", note: "проверь тёмную тему" }] });
    const items = [
      { id: "c1", where: "Вопросы", text: "без лишних файлов", done: false },
      { id: "c2", where: "Демонстрация", text: "проверь тёмную тему", done: false },
    ];
    expect(await store.getChecklist(THREAD)).toEqual({ approvalId: "A", items });
    expect((await call("getBrief", { id: "A" })).checklist).toEqual(items);
    expect(sent[0]!.text).toContain("c2 [ ] Демонстрация: проверь тёмную тему");
    expect(sent[0]!.text).toContain(CHECKLIST_TOOL);
    expect(sent[0]!.text).not.toContain("the approval stands");
  });

  it("ответы группы не записываются: виджеты вернулись агенту с черновиками, группа свёрнута", async () => {
    const { call, store } = await host();
    await store.putDraft("Q", "{}");
    await call("answerBrief", { id: "A", answer: rework("Доработай"), messageId: "m", group: [{ id: "Q", answer: picked("b") }, { id: "D", note: "x" }] });
    expect(await store.getAnswer("Q")).toBeNull();
    expect(await store.getDraft("Q")).not.toBeNull();
    expect(await store.getSentWith("D")).toBeNull();
    expect((await call("getBrief", { id: "D" })).fold).toBeDefined();
  });
});

describe("картинки из комментариев виджетов группы доходят до агента", () => {
  it("«на доработку»: картинка Демонстрации уходит вложением, её метка не путается с картинкой Утверждения", async () => {
    const { call, sent, uploaded } = await host();
    await call("answerBrief", {
      id: "A",
      answer: rework("смотри [Изображение 1]"),
      messageId: "m",
      images: [image(1, "approval")],
      group: [{ id: "Q", answer: picked("a") }, { id: "D", note: "кнопка [Изображение 1]", images: [image(1, "demo")] }],
    });
    expect(uploaded.map((u) => u.bytes).sort()).toEqual(["approval", "demo"]);
    expect(new Set(uploaded.map((u) => u.filename)).size).toBe(2);
    expect(sent[0]!.images).toHaveLength(2);
    const demoFile = uploaded.find((u) => u.bytes === "demo")!.filename;
    const label = sent[0]!.text.match(/Комментарий к «Демонстрация»: кнопка (\[Изображение \d+\])/)![1]!;
    expect(label).not.toBe("[Изображение 1]");
    expect(sent[0]!.text).toContain(`${label} — attachments/${demoFile}`);
  });

  it("«Продолжить»: картинка из комментария Демонстрации уходит вложением", async () => {
    const { call, sent, uploaded } = await host();
    await call("answerBrief", { id: "A", answer: proceed, messageId: "m", group: [{ id: "Q", answer: picked("a") }, { id: "D", note: "кнопка [Изображение 1]", images: [image(1, "demo")] }] });
    expect(uploaded.map((u) => u.bytes)).toEqual(["demo"]);
    expect(sent[0]!.images).toEqual([`attachments/${uploaded[0]!.filename}`]);
    expect(sent[0]!.text).toContain(`[Изображение 1] — attachments/${uploaded[0]!.filename}`);
  });

  it("картинка из комментария к ответу Вопросов уходит вложением", async () => {
    const { call, sent, uploaded } = await host();
    await call("answerBrief", { id: "A", answer: proceed, messageId: "m", group: [{ id: "Q", answer: picked("a", "вот так [Изображение 1]"), images: [image(1, "question")] }, { id: "D" }] });
    expect(uploaded.map((u) => u.bytes)).toEqual(["question"]);
    expect(sent[0]!.images).toHaveLength(1);
  });

  it("картинка без метки в комментарии виджета агенту не уходит", async () => {
    const { call, uploaded } = await host();
    await call("answerBrief", { id: "A", answer: proceed, messageId: "m", group: [{ id: "Q", answer: picked("a") }, { id: "D", note: "без картинки", images: [image(1, "demo")] }] });
    expect(uploaded).toEqual([]);
  });
});
