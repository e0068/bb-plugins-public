// @vitest-environment jsdom
// Бриф, созданный больше часа назад, открывается с выбранным «сжать»: кэш провайдера истёк, и первый шаг по нему записал бы
// весь контекст заново по двойной цене. Предвыбор зависит от возраста брифа, а не от размера контекста.
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DecisionAnswer, DecisionBrief, decisionsRpcContract, dispatchRpcContract } from "../shared/contract";
import { threadFiles } from "./file-roots-fixture";

const app = await loadPluginApp(() => import("../app"));

const NOW = Date.parse("2026-10-26T12:00:00.000Z");
const HOUR = 3_600_000;

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const briefAt = (ageMs: number): DecisionBrief => ({
  id: "dec_cache",
  threadId: "thr_1",
  title: "Кэш",
  createdAt: new Date(NOW - ageMs).toISOString(),
  kind: "brief",
  setup: { criteria: ["Тесты зелёные"] },
  questions: [],
});

const open = (shown: DecisionBrief, compact: boolean, sent: DecisionAnswer[]) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract & typeof dispatchRpcContract>(
    app.messageDirectives[0]!,
    {
      attributes: { id: shown.id },
      source: `::decision{id="${shown.id}"}`,
      message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null },
      openWorkspaceFile: () => true,
    },
    {
      rpc: {
        getBrief: () => ({ kind: "found", brief: shown, answer: null }),
        answerBrief: ({ answer }) => {
          sent.push(answer);
          return { kind: "not_found" };
        },
        // Контекст пуст: зона предвыбора не достигнута.
        getDispatchPlace: () => ({ place: "here", compact }),
        listProjects: () => ({ kind: "found" as const, projects: [] }),
        ...({ threadFiles } as object),
      },
    },
  );

type Slot = ReturnType<typeof open>;

const placeCell = (slot: Slot) => slot.findByRole("button", { name: /^Исполнять/ });

const sendWith = async (slot: Slot, sent: DecisionAnswer[]) => {
  fireEvent.click(slot.getByRole("button", { name: /^Отправить/ }));
  await waitFor(() => expect(sent).toHaveLength(1));
  return sent[0]!;
};

describe("предвыбор «сжать» по возрасту брифа", () => {
  it("бриф старше часа открывается со сжатием при пустом контексте, и оно уходит в ответе", async () => {
    const sent: DecisionAnswer[] = [];
    const slot = open(briefAt(HOUR + 1_000), false, sent);
    await waitFor(async () => expect((await placeCell(slot)).textContent).toContain("В этом треде · компактировать"));
    expect(await sendWith(slot, sent)).toMatchObject({ place: "here", compact: true });
  });

  it("бриф моложе часа открывается без сжатия", async () => {
    const sent: DecisionAnswer[] = [];
    const slot = open(briefAt(HOUR - 1_000), false, sent);
    expect((await placeCell(slot)).textContent).not.toContain("компактировать");
    expect((await sendWith(slot, sent)).compact).toBeUndefined();
  });

  it("зона контекста по-прежнему включает сжатие у свежего брифа", async () => {
    const sent: DecisionAnswer[] = [];
    const slot = open(briefAt(60_000), true, sent);
    await waitFor(async () => expect((await placeCell(slot)).textContent).toContain("компактировать"));
  });

  it("явное «Как есть» владельца главнее возраста брифа", async () => {
    const sent: DecisionAnswer[] = [];
    const slot = open(briefAt(2 * HOUR), false, sent);
    await waitFor(async () => expect((await placeCell(slot)).textContent).toContain("компактировать"));
    fireEvent.click(await placeCell(slot));
    fireEvent.click(within(await slot.findByRole("group", { name: "Контекст" })).getByRole("button", { name: "Как есть" }));
    expect((await sendWith(slot, sent)).compact).toBeUndefined();
  });

  it("открытый виджет переключается на отметке часа: за секунду до — нет, после — да", async () => {
    const sent: DecisionAnswer[] = [];
    const slot = open(briefAt(HOUR - 5_000), false, sent);
    expect((await placeCell(slot)).textContent).not.toContain("компактировать");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect((await placeCell(slot)).textContent).not.toContain("компактировать");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    await waitFor(async () => expect((await placeCell(slot)).textContent).toContain("В этом треде · компактировать"));
  });
});
