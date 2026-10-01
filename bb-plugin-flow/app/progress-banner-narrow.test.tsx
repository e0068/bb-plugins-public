// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

// На iPhone раскрытый прогресс-бар листался вбок: у упавшего шага отсчёт автоповтора,
// «Повторить» и «Пропустить» стояли в колонке `auto` без переноса, забирали 251 px из 348,
// названию шага оставалось 12 px, и строка выходила за список на 7 px.
// Причина — несжимаемое содержимое в колонке `auto` и несжимаемое имя шага; jsdom раскладку
// не считает, поэтому обещание проверяется по тому, что её задаёт.

afterEach(cleanup);

const LONG = "very-long-user-script-name-for-plugin-preview.sh";

const stage = (kind: "automation" | "action", step: Record<string, unknown>) => ({
  current: "land",
  done: 0,
  step: 1,
  total: 1,
  planned: null,
  environmentId: null,
  stages: [
    {
      id: "land",
      kind,
      name: "Влить и закрыть",
      executor: "self",
      state: step.state === "fail" ? "fail" : "now",
      results: [],
      minutes: null,
      cost: null,
      automation: { steps: [{ id: "script", label: LONG, error: null, ...step }] },
    },
  ],
});

const CASES = [
  ["упавший шаг с отсчётом автоповтора", stage("automation", { state: "fail", error: "untracked files would be overwritten", retryAt: new Date(Date.now() + 30_000).toISOString() })],
  ["шаг с запомненным пропуском", stage("automation", { state: "now", skipQueued: true })],
  ["шаг этапа-действия с кнопкой", stage("action", { state: "wait" })],
] as const;

const stepRow = async (progress: unknown) => {
  const app = await loadPluginApp(() => import("../app"));
  const banner = app.composerCustomizations.find((c) => c.id === "flow-progress")!.banners![0]!;
  renderSlot(banner, {}, { rpc: { getFlowProgress: () => progress } as never, composer: { scope: { kind: "thread", threadId: "thr_1" } }, settings: { language: "Русский" } });
  fireEvent.click(await screen.findByRole("button", { name: /Прогресс flow/ }));
  return (await screen.findByTitle(LONG)).closest("[data-progress-step]") as HTMLElement;
};

describe("строка шага не шире раскрытого прогресс-бара", () => {
  it.each(CASES)("%s: колонка `auto` пуста — кнопки и подписи переносятся под название", async (_, progress) => {
    const row = await stepRow(progress);
    expect(row.children[2]!.querySelector("button, [data-skip-queued]")).not.toBeNull();
    expect(row.children[3]!.childNodes).toHaveLength(0);
    expect(row.children[2]!.className).toMatch(/\bflex-wrap\b/);
  });

  it.each(CASES)("%s: длинное имя шага обрезается, а не распирает строку", async (_, progress) => {
    const name = (await stepRow(progress)).querySelector(`[title="${LONG}"]`)!;
    expect(name.className).toMatch(/\btruncate\b/);
    expect(name.className).toMatch(/\bmax-w-full\b/);
  });
});
