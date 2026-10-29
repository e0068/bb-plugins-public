// @vitest-environment node
// Бриф запуска тред-потомка адресуется родителю: работой дочерних управляет он, и карточка у владельца ему не нужна.
// Утверждение потомка и дочерний тред передачи работы остаются владельцу (BBPL-951).
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { STAGES } from "../core/stages-fixtures";
import { builtinStage } from "../lib/stage-constants";
import type { DecisionBrief, StageSettings } from "../shared/contract";
import { registerApi } from "./api";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { CHILD_ANSWER_TOOL } from "./child-answer-tool";
import { managingParentOf } from "./managing-parent";
import { createStore } from "./store";

const CHILD = "thr_child";
const PARENT = "thr_parent";
const taken = STAGES.map((s) => s.id);
const settings: StageSettings = { stages: [...STAGES, builtinStage("approve", taken)], minButtonWidth: 190 };
const launch = {
  title: "Вопросы запуска",
  questions: [{ id: "where", question: "Где чинить?", kind: "pick", options: [{ id: "a", action: "В плагине", description: "Правка Flow", recommended: true }, { id: "b", action: "В bb", description: "Правка хоста" }] }],
};
const approval = { title: "Утверждение запуска", outcome: { stage: "approve", final: false, next: "Execution", done: ["Definition of Done — два пункта"], pending: [], results: [{ label: "BBPL-951", target: "BBPL-951" }] } };
const decisionLine = '::decision{id=\\"dec_C1\\"}';

type Told = Array<{ parentId: string; text: string }>;

const send = async (params: object, opts: { parents?: Record<string, string>; tellParent?: (parentId: string, text: string) => Promise<void> } = {}) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  await store.markLaunched(CHILD);
  const told: Told = [];
  registerAskTool(bb, store, {
    newId: () => "C1",
    now: () => "2026-10-27T21:00:00.000Z",
    stages: () => settings,
    parentOf: async (id) => opts.parents?.[id] ?? null,
    tellParent: opts.tellParent ?? (async (parentId, text) => void told.push({ parentId, text })),
  });
  const result = JSON.stringify(await harness.callAgentTool(ASK_TOOL_NAME, params, { threadId: CHILD }));
  return { result, told, awaiting: await store.listAwaiting(), brief: await store.getBrief("dec_C1") };
};

describe("бриф тред-потомка", () => {
  it("бриф запуска уходит родителю: строки карточки нет, значка ожидания у владельца нет", async () => {
    const { result, told, awaiting, brief } = await send(launch, { parents: { [CHILD]: PARENT } });
    expect(brief?.threadId).toBe(CHILD);
    expect(result).not.toContain(decisionLine);
    expect(result).toContain(PARENT);
    expect(awaiting).toEqual([]);
    expect(told.map((t) => t.parentId)).toEqual([PARENT]);
    expect(told[0]!.text).toContain("dec_C1");
    expect(told[0]!.text).toContain(CHILD_ANSWER_TOOL);
  });

  it("Утверждение потомка остаётся владельцу: карточка и ожидание у него, родителю ничего", async () => {
    const { result, told, awaiting } = await send(approval, { parents: { [CHILD]: PARENT } });
    expect(result).toContain(decisionLine);
    expect(told).toEqual([]);
    expect(awaiting).toEqual([{ threadId: CHILD, briefId: "dec_C1", kind: "approve" }]);
  });

  it("тред без родителя по-прежнему показывает бриф запуска владельцу и ждёт его", async () => {
    const { result, told, awaiting } = await send(launch);
    expect(result).toContain(decisionLine);
    expect(told).toEqual([]);
    expect(awaiting).toEqual([{ threadId: CHILD, briefId: "dec_C1", kind: "questions" }]);
  });

  it("реплика родителю не дошла — бриф не пропадает, а остаётся владельцу", async () => {
    const { result, awaiting } = await send(launch, {
      parents: { [CHILD]: PARENT },
      tellParent: async () => {
        throw new Error("thread is archived");
      },
    });
    expect(result).toContain(decisionLine);
    expect(awaiting).toEqual([{ threadId: CHILD, briefId: "dec_C1", kind: "questions" }]);
  });
});

describe("дочерний тред передачи работы", () => {
  const source: DecisionBrief = {
    id: "dec_src",
    threadId: PARENT,
    title: "Работа",
    createdAt: "2026-10-27T21:00:00.000Z",
    kind: "brief",
    questions: [{ id: "ok", question: "Так?", kind: "yesno", allowOwn: false, options: [{ id: "yes", action: "Да", recommended: true }, { id: "no", action: "Нет", recommended: false }] }],
  };

  it("ведёт владелец: брифы запуска нового треда не уходят треду, отдавшему работу", async () => {
    const spawned: Array<{ parentThreadId?: string }> = [];
    const { bb, harness } = createFakePluginHost({
      pluginId: "flow",
      sdk: {
        threads: {
          get: async ({ threadId }: { threadId: string }) => ({ id: threadId, projectId: "prj_1", environmentId: "env_1", title: "Тред", providerId: "claude-code", parentThreadId: threadId === CHILD ? PARENT : null }),
          spawn: async (args: { parentThreadId?: string }) => {
            spawned.push(args);
            return { id: CHILD };
          },
        },
        environments: { get: async () => ({ hostId: "host_local", branchName: "bb/thr_parent", path: "/w" }) },
      } as never,
    });
    const store = createStore(bb.storage.kv);
    await store.putBrief(source);
    registerApi(bb, store, { now: () => "2026-10-27T21:00:00.000Z" });
    const answer = { briefId: source.id, answers: [{ questionId: "ok", optionIds: ["yes"] }], place: "child" as const };
    expect(await harness.callRpc("answerBrief", { id: source.id, messageId: "msg_1", answer })).toMatchObject({ kind: "accepted" });
    expect(spawned.map((s) => s.parentThreadId)).toEqual([PARENT]);

    const told: Told = [];
    await store.markLaunched(CHILD);
    registerAskTool(bb, store, { newId: () => "C1", now: () => "2026-10-27T21:01:00.000Z", stages: () => settings, parentOf: managingParentOf(store, bb.sdk), tellParent: async (parentId, text) => void told.push({ parentId, text }) });
    const result = JSON.stringify(await harness.callAgentTool(ASK_TOOL_NAME, launch, { threadId: CHILD }));
    expect(result).toContain(decisionLine);
    expect(told).toEqual([]);
  });
});
