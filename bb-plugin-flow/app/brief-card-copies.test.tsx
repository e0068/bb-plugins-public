// @vitest-environment jsdom
// Агент вставляет строку одного брифа в несколько сообщений подряд: стоп-хук
// требует повторить её, фоновая задача будит агента. Карточка одна — в последнем
// из этих сообщений, копии выше не рисуют ничего и не дают ответить второй раз.
import { cleanup, waitFor, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

import type { DecisionBrief } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const briefOf = (id: string, title: string): DecisionBrief => ({
  id,
  threadId: "thr_1",
  title,
  createdAt: "2026-10-02T12:00:00.000Z",
  kind: "brief",
  questions: [
    { id: "q", kind: "fork", question: "Как делать?", allowOwn: false, options: [
      { id: "a", action: "Так", recommended: true, description: "Первый путь." },
      { id: "b", action: "Иначе", recommended: false, description: "Второй путь." },
    ] },
  ],
});

const first = briefOf("dec_copies", "Бриф, вставленный трижды");
const other = briefOf("dec_other", "Соседний бриф");

const mount = (brief: DecisionBrief, messageId: string) =>
  renderSlot<PluginMessageDirectiveProps, never>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: messageId, threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief, answer: null }), getRunSummary: () => null, getDispatchPlace: () => ({ place: "here" }), listProjects: () => ({ kind: "found" as const, projects: [] }) } as never, settings: { language: "Русский" } },
  );

type Slot = ReturnType<typeof mount>;

const shown = (slot: Slot, brief: DecisionBrief) => within(slot.container).queryAllByRole("group", { name: brief.title }).length > 0;
const card = (slot: Slot, brief: DecisionBrief) => within(slot.container).findAllByRole("group", { name: brief.title });

describe("копии строки брифа в ленте", () => {
  it("строка в трёх сообщениях даёт одну карточку — в последнем", async () => {
    const slots = [mount(first, "msg_1"), mount(first, "msg_2"), mount(first, "msg_3")];
    await card(slots[2]!, first);
    expect(slots.map((slot) => shown(slot, first))).toEqual([false, false, true]);
  });

  it("у копий выше нет кнопок ответа", async () => {
    const [above, last] = [mount(first, "msg_1"), mount(first, "msg_2")];
    await card(last, first);
    expect(above.container.querySelectorAll("button")).toHaveLength(0);
  });

  it("разные брифы рисуются каждый в своём сообщении", async () => {
    const [a, b] = [mount(first, "msg_1"), mount(other, "msg_2")];
    await card(a, first);
    await card(b, other);
  });

  it("последняя копия ушла из ленты — карточка встаёт в предыдущей", async () => {
    const [above, last] = [mount(first, "msg_1"), mount(first, "msg_2")];
    await card(last, first);
    last.unmount();
    await waitFor(() => expect(shown(above, first)).toBe(true));
  });
});
