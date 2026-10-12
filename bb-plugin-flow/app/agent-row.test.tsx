// @vitest-environment jsdom
// Кнопки модели и Flow в ряду Утверждения — по прототипу владельца: квадрат, пока выбор текущий; пометки колонок: галочка у
// выбранного, ✦ у предложения агента всегда, «Сейчас» у текущего; другой провайдер — «в новом треде», «В этом треде» выключено.
import { cleanup, configure, fireEvent, waitFor, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { DecisionAnswer, DecisionBrief, decisionsRpcContract, dispatchRpcContract, widgetAgentRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

// Каталог выбора агента приходит RPC: под нагрузкой полной прогонки его ждать дольше секунды по умолчанию.
configure({ asyncUtilTimeout: 10_000 });

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const approval: DecisionBrief = {
  id: "dec_row",
  threadId: "thr_1",
  title: "Утверждение",
  createdAt: "2026-10-12T10:00:00.000Z",
  kind: "brief",
  launched: true,
  questions: [],
  outcome: { stage: "approve", final: false, next: "Spec", done: ["Сделано"], pending: [], results: [{ label: "a.md", target: "a.md" }], nextFlow: "bb" },
  stages: { list: [builtinStage("approve", [])], minButtonWidth: 160 },
};

/** Тот же итог без рекомендованного flow: ключа `nextFlow` в нём нет. */
const { nextFlow: _next, ...plainOutcome } = approval.outcome!;
const plain: DecisionBrief = { ...approval, outcome: plainOutcome };

const opus = { providerId: "claude-code", model: "opus", reasoningLevel: "high" as const };
const catalog = {
  current: opus,
  currentFlowId: "bug",
  providers: [
    { id: "claude-code", name: "Claude Code", models: [{ model: "opus", name: "Opus", efforts: ["medium" as const, "high" as const], defaultEffort: "high" as const }, { model: "sonnet", name: "Sonnet", efforts: ["medium" as const], defaultEffort: "medium" as const }] },
    { id: "codex", name: "Codex", models: [{ model: "gpt-5-codex", name: "GPT-5 Codex", efforts: ["medium" as const], defaultEffort: "medium" as const }] },
  ],
  flows: [{ id: "bug", name: "Bug" }, { id: "bb", name: "BB Plugin" }],
};

const open = (sent: DecisionAnswer[], brief: DecisionBrief = approval) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract & typeof dispatchRpcContract & typeof widgetAgentRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    {
      rpc: {
        getBrief: () => ({ kind: "found", brief, answer: null }),
        answerBrief: ({ answer }: { answer: DecisionAnswer }) => {
          sent.push(answer);
          return { kind: "not_found" };
        },
        getDispatchPlace: () => ({ place: "here" }),
        listProjects: () => ({ kind: "found" as const, projects: [] }),
        widgetAgent: () => catalog,
      },
    },
  );

describe("ряд кнопок Утверждения", () => {
  it("модель первой, за ней Flow, «Исполнять» и главная кнопка; модель — квадрат, пока выбор текущий", async () => {
    const slot = open([], plain);
    const flow = await slot.findByRole("button", { name: "Flow: Bug" });
    const model = slot.getByRole("button", { name: /Модель: Opus/ });
    const place = slot.getByRole("button", { name: /^Исполнять/ });
    const main = slot.getByRole("button", { name: "Продолжить" });
    const before = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect([before(model, flow), before(flow, place), before(place, main)]).toEqual([true, true, true]);
    expect(model.className).toContain("w-10");
    expect(flow.className).toContain("w-10");
  });

  it("колонка Flow: предложение агента — галочка и ✦, на текущем — «Сейчас»; вернул текущий — галочка на нём, ✦ остаётся", async () => {
    const slot = open([]);
    fireEvent.click(await slot.findByRole("button", { name: "Flow: BB Plugin" }));
    const list = within(await slot.findByRole("group", { name: "Flow" }));
    expect(list.getByRole("button", { name: /Bug.*Сейчас/ }).getAttribute("aria-pressed")).toBe("false");
    expect(list.getByRole("button", { name: /BB Plugin.*предлагает агент/ }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(list.getByRole("button", { name: /Bug/ }));
    const after = within(slot.getByRole("group", { name: "Flow" }));
    expect(after.getByRole("button", { name: /^Bug/ }).getAttribute("aria-pressed")).toBe("true");
    expect(after.getByRole("button", { name: /BB Plugin.*предлагает агент/ })).toBeTruthy();
    expect(slot.getByRole("button", { name: "Flow: Bug" }).className).toContain("w-10");
  });

  it("другой провайдер сразу ставит «Новый тред», «В этом треде» выключено, ответ несёт провайдера и новое место", async () => {
    const sent: DecisionAnswer[] = [];
    const slot = open(sent, plain);
    fireEvent.click(await slot.findByRole("button", { name: /Модель: Opus/ }));
    const providers = within(await slot.findByRole("group", { name: "Провайдер" }));
    fireEvent.click(providers.getByRole("button", { name: /Codex/ }));
    expect(slot.getByRole("button", { name: /^Исполнять/ }).textContent).toContain("Новый тред");
    fireEvent.click(slot.getByRole("button", { name: /^Исполнять/ }));
    const threads = within(await slot.findByRole("group", { name: "Тред" }));
    expect((threads.getByRole("button", { name: /В этом треде/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(slot.getByRole("button", { name: /Отправить комментарии|Продолжить/ }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.execution).toEqual({ providerId: "codex", model: "gpt-5-codex", reasoningLevel: "medium" });
    expect(sent[0]?.place).toBe("thread");
  });
});
