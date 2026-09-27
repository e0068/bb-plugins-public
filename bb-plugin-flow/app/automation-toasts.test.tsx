// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { Toaster, toast } from "sonner";
import { afterEach, describe, expect, it } from "vitest";

import { AUTOMATION_NOTICE_CHANNEL, type AutomationNotice } from "../core/automation-notice";

afterEach(() => {
  act(() => void toast.dismiss());
  cleanup();
});

const PR_URL = "https://github.com/e0068/bb-plugins/pull/541";

let seq = 0;
const nextId = () => `n${++seq}`;

const doneNotice = (): AutomationNotice => ({
  kind: "done",
  id: nextId(),
  threadId: "thr_1",
  threadTitle: "Уведомления Flow",
  stageId: "publish",
  stageName: "Commit, FF to Main, PR",
  flowId: "flow-code",
  pr: { number: 541, url: PR_URL },
  steps: [
    { id: "git.create-pr", label: "Open a PR", detail: PR_URL },
    { id: "bb.tasks-in-review", label: "Task → in_review", detail: "BBPL-12" },
  ],
});

const failedNotice = (): AutomationNotice => ({
  kind: "failed",
  id: nextId(),
  threadId: "thr_1",
  threadTitle: "Уведомления Flow",
  stageId: "land",
  stageName: "Merge",
  flowId: null,
  pr: null,
  steps: [{ id: "git.merge", label: "Merge the PR" }].map((s) => ({ ...s, detail: null })),
  stepId: "git.merge",
  error: "not mergeable",
  retryAt: null,
});

const mount = async (rpc: Record<string, () => unknown> = {}) => {
  const app = await loadPluginApp(() => import("../app"));
  const banner = app.composerCustomizations.find((c) => c.id === "flow-progress")!.banners!.find((b) => b.id === "notices")!;
  return renderSlot(banner, {}, { rpc: { getFlowProgress: () => null, ...rpc } as never, composer: { scope: { kind: "thread", threadId: "thr_2" } }, settings: { language: "Русский" } });
};

describe("тосты об автоматизациях Flow", () => {
  it("доигранный этап — тост с этапом, тредом, PR и задачей; одно событие у двух слушателей — один тост", async () => {
    render(<Toaster />);
    const first = await mount();
    const second = await mount();
    const notice = doneNotice();
    await first.emitRealtime(AUTOMATION_NOTICE_CHANNEL, notice);
    await second.emitRealtime(AUTOMATION_NOTICE_CHANNEL, notice);
    await screen.findByText(/— готово/);
    expect(screen.getAllByText(/— готово/)).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Commit, FF to Main, PR" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Уведомления Flow" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "PR #541" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "BBPL-12" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "View on GitHub" })).toBeTruthy();
  });

  it("клики по упоминаниям: тред — переход в тред, PR — ссылка наружу, flow — страница flow", async () => {
    render(<Toaster />);
    const slot = await mount();
    for (const name of ["PR #541", "Уведомления Flow", "Commit, FF to Main, PR"]) {
      await slot.emitRealtime(AUTOMATION_NOTICE_CHANNEL, doneNotice());
      fireEvent.click(await screen.findByRole("button", { name }));
      await waitFor(() => expect(screen.queryByText(/— готово/)).toBeNull());
    }
    expect(slot.navigateCalls).toEqual([
      expect.objectContaining({ method: "openUrl", url: PR_URL }),
      { method: "toThread", threadId: "thr_1" },
      expect.objectContaining({ method: "toPluginPanel", path: "flows" }),
    ]);
  });

  it("задача открывается якорем Tasks+ внутри корня плагина: тост в портале хост не ловит", async () => {
    render(<Toaster />);
    const slot = await mount();
    const clicked: Array<{ href: string | null; meta: boolean }> = [];
    slot.container.addEventListener("click", (event) => {
      const anchor = (event.target as HTMLElement).closest("a");
      clicked.push({ href: anchor?.getAttribute("href") ?? null, meta: event.metaKey });
      event.preventDefault();
    });
    await slot.emitRealtime(AUTOMATION_NOTICE_CHANNEL, doneNotice());
    fireEvent.click(await screen.findByRole("button", { name: "BBPL-12" }));
    expect(clicked).toEqual([{ href: "/plugins/tasks-plus/tasks/task/BBPL-12", meta: true }]);
    expect(slot.container.querySelector("a")).toBeNull();
  });

  it("упавший шаг — тост с шагом и ошибкой; «Повторить» и «Пропустить» зовут те же RPC, что баннер", async () => {
    render(<Toaster />);
    const slot = await mount({ retryAutomation: () => ({ started: true }), skipAutomationStep: () => ({ started: true }) });
    await slot.emitRealtime(AUTOMATION_NOTICE_CHANNEL, failedNotice());
    expect(await screen.findByText(/шаг «Смёрджить PR» упал/)).toBeTruthy();
    expect(screen.getByText("not mergeable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    await waitFor(() => expect(screen.queryByText("not mergeable")).toBeNull());
    await slot.emitRealtime(AUTOMATION_NOTICE_CHANNEL, failedNotice());
    fireEvent.click(await screen.findByRole("button", { name: "Пропустить" }));
    await waitFor(() =>
      expect(slot.rpcCalls.filter((c) => c.method !== "getFlowProgress").map((c) => [c.method, c.input])).toEqual([
        ["retryAutomation", { threadId: "thr_1", stage: "land" }],
        ["skipAutomationStep", { threadId: "thr_1", stage: "land" }],
      ]),
    );
  });

  it("повтор, на который Flow ответил «не начат», сообщает, что шаг уже не ждёт", async () => {
    render(<Toaster />);
    const slot = await mount({ retryAutomation: () => ({ started: false }) });
    await slot.emitRealtime(AUTOMATION_NOTICE_CHANNEL, failedNotice());
    fireEvent.click(await screen.findByRole("button", { name: "Повторить" }));
    expect(await screen.findByText(/Этап «Merge» уже не ждёт/)).toBeTruthy();
  });

  it("тост висит, пока его не закроют крестиком", async () => {
    render(<Toaster />);
    const slot = await mount();
    await slot.emitRealtime(AUTOMATION_NOTICE_CHANNEL, doneNotice());
    await screen.findByText(/— готово/);
    fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));
    await waitFor(() => expect(screen.queryByText(/— готово/)).toBeNull());
  });

  it("новое событие того же этапа заменяет тост: повторные падения не копятся, а итог сменяет ошибку", async () => {
    render(<Toaster />);
    const slot = await mount();
    await slot.emitRealtime(AUTOMATION_NOTICE_CHANNEL, failedNotice());
    await slot.emitRealtime(AUTOMATION_NOTICE_CHANNEL, failedNotice());
    await screen.findByText(/упал/);
    expect(screen.getAllByText(/упал/)).toHaveLength(1);
    await slot.emitRealtime(AUTOMATION_NOTICE_CHANNEL, { ...doneNotice(), stageId: "land", stageName: "Merge" });
    await screen.findByText(/— готово/);
    expect(screen.queryByText(/упал/)).toBeNull();
  });

  it("разные этапы — разные тосты", async () => {
    render(<Toaster />);
    const slot = await mount();
    await slot.emitRealtime(AUTOMATION_NOTICE_CHANNEL, doneNotice());
    await slot.emitRealtime(AUTOMATION_NOTICE_CHANNEL, { ...doneNotice(), stageId: "land", stageName: "Merge" });
    await waitFor(() => expect(screen.getAllByText(/— готово/)).toHaveLength(2));
  });
});
