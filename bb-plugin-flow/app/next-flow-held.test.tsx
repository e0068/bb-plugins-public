// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);

const flows = { flows: [{ id: "flow_dev", name: "Разработка" }, { id: "flow_fix", name: "Правка" }] };

const mount = async (options: { held: boolean; start?: (input: unknown) => unknown }) => {
  const app = await loadPluginApp(() => import("../app"));
  const customization = app.composerCustomizations.find((c) => c.id === "flow-progress")!;
  const form = customization.banners!.find((b) => b.id === "next-flow")!;
  const calls: unknown[] = [];
  const slot = renderSlot(
    form,
    {},
    {
      rpc: {
        nextRunHeld: () => ({ held: options.held }),
        nextRunFlows: () => flows,
        startNextRun: (input: unknown) => {
          calls.push(input);
          return options.start?.(input) ?? { kind: "sent" as const };
        },
      } as never,
      composer: { scope: { kind: "thread", threadId: "thr_1" } },
      settings: { language: "Русский" },
    },
  );
  return { slot, calls };
};

const ready = async (slot: Awaited<ReturnType<typeof mount>>["slot"]) => waitFor(() => expect(slot.container.querySelectorAll("[data-next-flow-option]").length).toBe(3));

describe("форма выбора flow появляется только над придержанным сообщением", () => {
  it("пока владелец ничего не отправил, формы нет — даже на завершённом прогоне", async () => {
    const { slot } = await mount({ held: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(slot.container.querySelector("[data-next-flow]")).toBeNull();
  });

  it("сообщение придержано — видны flow владельца и «Без flow»", async () => {
    const { slot } = await mount({ held: true });
    await ready(slot);
    expect(slot.container.textContent).toContain("Разработка");
    expect(slot.container.textContent).toContain("Без flow");
  });

  it("выбор уходит с flow и галкой компактации, без текста — сообщение уже отправлено", async () => {
    const { slot, calls } = await mount({ held: true });
    await ready(slot);
    fireEvent.click(slot.container.querySelector('[data-next-flow-option="flow_fix"]')!);
    fireEvent.click(slot.container.querySelector("[data-next-flow-send]")!);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ threadId: "thr_1", flowId: "flow_fix", compact: true });
  });

  it("галка компактации снимается и уезжает выключенной", async () => {
    const { slot, calls } = await mount({ held: true });
    await ready(slot);
    fireEvent.click(slot.container.querySelector("[data-next-flow-compact]")!);
    fireEvent.click(slot.container.querySelector("[data-next-flow-send]")!);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ compact: false });
  });

  it("после отпущенного сообщения форма уходит сразу, не дожидаясь опроса", async () => {
    const { slot, calls } = await mount({ held: true });
    await ready(slot);
    fireEvent.click(slot.container.querySelector("[data-next-flow-send]")!);
    await waitFor(() => expect(calls).toHaveLength(1));
    await waitFor(() => expect(slot.container.querySelector("[data-next-flow]")).toBeNull());
  });

  it("отказ сервера показан причиной, а не молчанием", async () => {
    const { slot } = await mount({ held: true, start: () => ({ kind: "failed" as const, reason: "host down" }) });
    await ready(slot);
    fireEvent.click(slot.container.querySelector("[data-next-flow-send]")!);
    await waitFor(() => expect(slot.container.textContent).toContain("host down"));
  });
});
