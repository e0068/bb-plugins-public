// @vitest-environment jsdom
// Снимок в разделе демонстрации — `![подпись](путь от корня дерева)`, как его пишет агент. Карточка показывает сам
// снимок с маршрута Flow, а не плашку «подпись — путь». Движок настоящий: jsdom строит его разметку, как браузер.
import { cleanup, waitFor } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

import { briefImageUrl } from "../core/brief-image";
import type { DecisionBrief, decisionsRpcContract } from "../shared/contract";
import { threadFiles } from "./file-roots-fixture";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const SHOT = "docs/prototypes/SHA-315/1-variables-tabbar.jpg";

const demo: DecisionBrief = {
  id: "dec_shots",
  threadId: "thr_1",
  title: "Прототип",
  createdAt: "2026-10-22T00:00:00.000Z",
  kind: "brief",
  revocable: true,
  launched: true,
  questions: [],
  outcome: {
    stage: "prototype.demo",
    final: true,
    done: ["Снимки сняты"],
    pending: [],
    sections: [{ title: "Раздел и таб-меню", text: `![Variables на 390: Collections во всю ширину](${SHOT})\n\nРазделов в Shell шесть.` }],
    results: [{ label: "1-variables-tabbar.jpg", target: SHOT }],
  },
};

const open = (shown: DecisionBrief) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: shown.id }, source: `::decision{id="${shown.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief: shown, answer: null }), answerBrief: () => ({ kind: "not_found" }), ...({ threadFiles } as object) } },
  );

describe("снимок в тексте демонстрации", () => {
  it("путь от корня дерева — картинка с маршрута Flow для треда брифа, без плашки", async () => {
    const slot = open(demo);
    const card = await slot.findByRole("group", { name: "Демонстрация" });
    await waitFor(() => expect(card.querySelector("img")?.getAttribute("src")).toBe(briefImageUrl("thr_1", SHOT)));
    expect(card.querySelector(".mde-imgerr")).toBeNull();
  });

  it("у треда нет дерева — снимку неоткуда грузиться, на его месте плашка с подписью, а не битая картинка", async () => {
    const slot = renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
      app.messageDirectives[0]!,
      { attributes: { id: demo.id }, source: `::decision{id="${demo.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
      { rpc: { getBrief: () => ({ kind: "found", brief: demo, answer: null }), answerBrief: () => ({ kind: "not_found" }), ...({ threadFiles: () => ({ environmentId: null, storage: null }) } as object) } },
    );
    const card = await slot.findByRole("group", { name: "Демонстрация" });
    await waitFor(() => expect(card.querySelector(".mde-imgerr")?.textContent).toContain(SHOT));
    expect(card.querySelector("img")).toBeNull();
  });
});
