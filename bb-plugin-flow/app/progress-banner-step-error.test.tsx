// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);

const ERROR = "GitHub: Pull Request is not mergeable because the base branch has moved";

const view = {
  current: "land",
  done: 0,
  step: 1,
  total: 1,
  planned: null,
  environmentId: null,
  stages: [
    {
      id: "land",
      kind: "skill",
      name: "Merge",
      executor: "self",
      state: "fail",
      results: [],
      minutes: null,
      cost: null,
      automation: { steps: [{ id: "git.merge", label: "Merge", state: "fail", error: ERROR }] },
    },
  ],
};

describe("ошибка шага автоматизации", () => {
  it("начинается своей строкой под названием шага и читается целиком", async () => {
    const app = await loadPluginApp(() => import("../app"));
    const customization = app.composerCustomizations.find((c) => c.id === "flow-progress")!;
    const slot = renderSlot(customization.banners![0]!, {}, {
      rpc: { getFlowProgress: () => view } as never,
      composer: { scope: { kind: "thread", threadId: "thr_1" } },
      settings: { language: "Русский" },
    });
    fireEvent.click(await screen.findByRole("button", { name: /Прогресс flow/ }));
    const error = slot.container.querySelector<HTMLElement>("[data-step-error]")!;
    expect(error.textContent).toBe(ERROR);
    expect(error.closest("[data-step-name]")).toBeNull();
  });
});
