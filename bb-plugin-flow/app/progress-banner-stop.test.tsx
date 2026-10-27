// @vitest-environment jsdom
// BBPL-969: «Стоп» в шапке баннера — видна и в свёрнутом; после нажатия «Останавливается…», после остановки «Продолжить».
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

import { en } from "../lib/messages/en";
import { ru } from "../lib/messages/ru";

afterEach(cleanup);

type Mode = "running" | "stopping" | "stopped";

const land = (mode: Mode, kind = "skill") => ({
  id: "land",
  kind,
  name: "Commit, PR",
  executor: "self",
  state: mode === "stopped" ? "fail" : "now",
  live: mode !== "stopped",
  results: [],
  minutes: null,
  cost: null,
  automation: {
    stopping: mode === "stopping",
    stopped: mode === "stopped",
    steps: [
      { id: "git.commit", label: "Commit", state: "done", error: null, detail: null, retryAt: null, skipQueued: false },
      { id: "script:1", label: "slow.sh", state: mode === "stopped" ? "stop" : "now", error: mode === "stopped" ? "Stopped by the owner." : null, detail: null, retryAt: null, skipQueued: false },
      { id: "git.create-pr", label: "Open a PR", state: "todo", error: null, detail: null, retryAt: null, skipQueued: false },
    ],
  },
});

const view = (mode: Mode, kind = "skill", carrier?: { threadId: string }) => ({
  current: "land",
  done: 1,
  step: 2,
  total: 2,
  planned: null,
  environmentId: null,
  ...(carrier === undefined ? {} : { carrier }),
  stages: [{ id: "review", kind: "skill", name: "Ревью", executor: "self", state: "done", results: [], minutes: 12, cost: 4 }, land(mode, kind)],
});

const mount = async (progress: unknown) => {
  const app = await loadPluginApp(() => import("../app"));
  const customization = app.composerCustomizations.find((c) => c.id === "flow-progress")!;
  return renderSlot(customization.banners![0]!, {}, {
    rpc: { getFlowProgress: () => progress, retryAutomation: () => ({ started: true }), stopAutomation: () => ({ started: true }) } as never,
    composer: { scope: { kind: "thread", threadId: "thr_1" } },
    settings: { language: "Русский" },
  });
};

const head = async () => screen.findByRole("button", { name: /Прогресс flow/ });

describe("подписи остановки есть на обоих языках", () => {
  it("кнопки и строки шагов подписаны по-русски и по-английски", () => {
    expect([ru.progress.stop, ru.progress.stopping, ru.progress.continue, ru.progress.stoppingStep]).toEqual(["Стоп", "Останавливается…", "Продолжить", "Останавливается — дожидается конца шага"]);
    expect([en.progress.stop, en.progress.stopping, en.progress.continue, en.progress.stoppingStep]).toEqual(["Stop", "Stopping…", "Continue", "Stopping — waits for the step to end"]);
    expect(ru.progress.stoppedStep("Stopped by the owner.")).toBe("Остановлено владельцем — Stopped by the owner.");
    expect(ru.progress.stoppedStep("")).toBe("Остановлено владельцем");
    expect(en.progress.stoppedStep("boom")).toBe("Stopped by the owner — boom");
  });
});

describe("Стоп в шапке баннера", () => {
  it("идущая автоматизация: «Стоп» в свёрнутой шапке, не внутри кнопки шапки; нажатие зовёт stopAutomation и баннер не раскрывает", async () => {
    const slot = await mount(view("running"));
    const toggle = await head();
    const stop = await screen.findByRole("button", { name: "Стоп" });
    expect(toggle.contains(stop)).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(stop);
    await waitFor(() => expect(slot.rpcCalls.find((c) => c.method === "stopAutomation")?.input).toEqual({ threadId: "thr_1", stage: "land" }));
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("запрос остановки: «Останавливается…» без кнопки, идущий шаг дожидается конца", async () => {
    const slot = await mount(view("stopping"));
    fireEvent.click(await head());
    expect(await screen.findByText("Останавливается…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Стоп" })).toBeNull();
    const steps = [...slot.container.querySelectorAll<HTMLElement>("[data-progress-step]")];
    expect(steps[1]!.textContent).toContain("Останавливается — дожидается конца шага");
  });

  it("остановлена: «Продолжить» зовёт повтор, шаг серый «Остановлено владельцем» без «Повторить» и «Пропустить»", async () => {
    const slot = await mount(view("stopped"));
    const proceed = await screen.findByRole("button", { name: "Продолжить" });
    fireEvent.click(proceed);
    await waitFor(() => expect(slot.rpcCalls.find((c) => c.method === "retryAutomation")?.input).toEqual({ threadId: "thr_1", stage: "land" }));
    fireEvent.click(await head());
    const steps = [...slot.container.querySelectorAll<HTMLElement>("[data-progress-step]")];
    expect(steps[1]!.textContent).toContain("Остановлено владельцем — Stopped by the owner.");
    expect(within(steps[1]!).queryByRole("button")).toBeNull();
  });

  it("остановленная — не упавшая: ни сегмент полосы, ни значок этапа не красные", async () => {
    const slot = await mount(view("stopped"));
    await screen.findByRole("button", { name: "Продолжить" });
    const segments = [...slot.container.querySelectorAll<HTMLElement>("[data-progress-segment]")];
    expect(segments[1]!.className).toContain("bg-muted-foreground");
    expect(slot.container.innerHTML).not.toContain("destructive");
  });

  it("этап Action «Стоп» не показывает", async () => {
    await mount(view("running", "action"));
    await head();
    expect(screen.queryByRole("button", { name: "Стоп" })).toBeNull();
  });

  it("прогон ведёт другой тред — кнопки нет", async () => {
    await mount(view("running", "skill", { threadId: "thr_carrier" }));
    await head();
    expect(screen.queryByRole("button", { name: "Стоп" })).toBeNull();
  });
});

describe("ченж-лог: пункт задачи на двух языках", () => {
  it("пункт ждёт версии и говорит по-русски и по-английски", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const text = readFileSync(join(process.cwd(), "changelog", "flow-knopka-stop-u-iduschei-avtomatizacii.md"), "utf8");
    expect(text).toMatch(/^---\nversion: coming-soon\n---\n/);
    expect(text).toMatch(/\n- ru: \S.*\n {2}en: \S/);
  });
});
