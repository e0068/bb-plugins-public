// @vitest-environment jsdom
// Утверждение, за которым агенту делать нечего (`idleAfter` от getBrief),
// не предлагает компактацию: она тратит ход, которого не будет. Комментарий
// возвращает работу агенту — тогда сжатие перед ней снова имеет смысл.
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { DecisionAnswer, DecisionBrief, decisionsRpcContract, dispatchRpcContract } from "../shared/contract";
import { threadFiles } from "./file-roots-fixture";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const approval: DecisionBrief = {
  id: "dec_idleafter",
  threadId: "thr_1",
  title: "Утверждение перед мёрджем",
  createdAt: "2026-10-22T06:00:00.000Z",
  kind: "brief",
  launched: true,
  questions: [],
  outcome: { stage: "approve", final: false, done: ["Сделано"], pending: [], results: [{ label: "x", target: "x.md" }] },
  stages: { list: [builtinStage("approve", [])], minButtonWidth: 160 },
};

/** Тред в зоне предвыбора компактации; `idleAfter` — что отдал getBrief. */
const open = (idleAfter: boolean, sent: DecisionAnswer[]) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract & typeof dispatchRpcContract>(
    app.messageDirectives[0]!,
    {
      attributes: { id: approval.id },
      source: `::decision{id="${approval.id}"}`,
      message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null },
      openWorkspaceFile: () => true,
    },
    {
      rpc: {
        getBrief: () => ({ kind: "found", brief: approval, answer: null, ...(idleAfter ? { idleAfter: true as const } : {}) }),
        answerBrief: ({ answer }) => {
          sent.push(answer);
          return { kind: "not_found" };
        },
        getDispatchPlace: () => ({ place: "here" as const, compact: true }),
        listProjects: () => ({ kind: "found" as const, projects: [] }),
        ...({ threadFiles } as object),
      },
    },
  );

type Slot = ReturnType<typeof open>;

const placeCell = (slot: Slot) => slot.findByRole("button", { name: /^Исполнять/ });
const comment = (slot: Slot, text: string) => fireEvent.change(slot.getByRole("textbox", { name: "Комментарий к утверждению" }), { target: { value: text } });
const send = async (slot: Slot, sent: DecisionAnswer[], button: RegExp) => {
  fireEvent.click(slot.getByRole("button", { name: button }));
  await waitFor(() => expect(sent).toHaveLength(1));
  return sent[0]!;
};

describe("утверждение, после которого агенту делать нечего", () => {
  it("открывается без компактации — ни в ячейке, ни в её выборе, — и «Продолжить» уходит без неё", async () => {
    const sent: DecisionAnswer[] = [];
    const slot = open(true, sent);
    await waitFor(async () => expect((await placeCell(slot)).textContent).toContain("В этом треде"));
    expect((await placeCell(slot)).textContent).not.toContain("компактировать");
    fireEvent.click(await placeCell(slot));
    expect(slot.queryByRole("group", { name: "Контекст" })).toBeNull();
    expect((await send(slot, sent, /^Продолжить/)).compact).toBeUndefined();
  });

  it("написан комментарий — компактация появляется по зоне контекста и уходит с комментарием", async () => {
    const sent: DecisionAnswer[] = [];
    const slot = open(true, sent);
    await placeCell(slot);
    comment(slot, "Поправь подпись");
    await waitFor(async () => expect((await placeCell(slot)).textContent).toContain("компактировать"));
    expect(await send(slot, sent, /^Отправить комментарии/)).toMatchObject({ place: "here", compact: true });
  });

  it("комментарий стёрли — компактация снова пропадает", async () => {
    const sent: DecisionAnswer[] = [];
    const slot = open(true, sent);
    await placeCell(slot);
    comment(slot, "Поправь подпись");
    await waitFor(async () => expect((await placeCell(slot)).textContent).toContain("компактировать"));
    comment(slot, "");
    await waitFor(async () => expect((await placeCell(slot)).textContent).not.toContain("компактировать"));
    expect((await send(slot, sent, /^Продолжить/)).compact).toBeUndefined();
  });

  it("с работой агента впереди утверждение по-прежнему открывается с компактацией", async () => {
    const sent: DecisionAnswer[] = [];
    const slot = open(false, sent);
    await waitFor(async () => expect((await placeCell(slot)).textContent).toContain("компактировать"));
    expect(await send(slot, sent, /^Продолжить/)).toMatchObject({ place: "here", compact: true });
  });
});
