// @vitest-environment jsdom
// Снимок в разделе демонстрации абсолютным путём — из хранилища треда или из его дерева, как его пишет агент. Карточка
// грузит его маршрутом Flow, а не по сырому пути, который браузер bb не отдаёт; не загрузился — плашка с путём из текста.
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

import { briefImageUrl } from "../core/brief-image";
import type { DecisionBrief, decisionsRpcContract } from "../shared/contract";
import { STORAGE, threadFiles } from "./file-roots-fixture";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const STORED = `${STORAGE}/repro/storage-shot.png`;
const IN_TREE = "/w/thr_1/bb-plugins/.repro/tree-shot.png";

const demo = (text: string): DecisionBrief => ({
  id: "dec_abs",
  threadId: "thr_1",
  title: "Починка",
  createdAt: "2026-10-28T00:00:00.000Z",
  kind: "brief",
  revocable: true,
  launched: true,
  questions: [],
  outcome: { stage: "demo", final: true, done: ["Снимки сняты"], pending: [], sections: [{ title: "Снимки", text }], results: [{ label: "storage-shot.png", target: STORED }] },
});

const open = (shown: DecisionBrief) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: shown.id }, source: `::decision{id="${shown.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief: shown, answer: null }), answerBrief: () => ({ kind: "not_found" }), ...({ threadFiles } as object) } },
  );

const sources = (card: HTMLElement) => [...card.querySelectorAll("img")].map((img) => img.getAttribute("src"));

describe("снимок по абсолютному пути в тексте демонстрации", () => {
  it("снимок из хранилища треда и снимок из дерева треда — картинки с маршрута Flow, без плашки", async () => {
    const slot = open(demo(`![Хранилище](${STORED})\n\n![Дерево](${IN_TREE})`));
    const card = await slot.findByRole("group", { name: "Демонстрация" });
    await waitFor(() => expect(sources(card)).toEqual([briefImageUrl("thr_1", STORED), briefImageUrl("thr_1", IN_TREE)]));
    expect(card.querySelector(".mde-imgerr")).toBeNull();
  });

  it("снимок не загрузился — плашка с подписью и путём из текста, а не с адресом маршрута", async () => {
    const slot = open(demo(`![Чужой](/etc/a.png)`));
    const card = await slot.findByRole("group", { name: "Демонстрация" });
    await waitFor(() => expect(card.querySelector("img")).not.toBeNull());
    fireEvent.error(card.querySelector("img")!);
    expect(card.querySelector(".mde-imgerr")?.textContent).toBe("🖼Чужой — /etc/a.png");
  });

  it("путь в блоке кода остаётся текстом как написан, а снимок в обратных кавычках движок рисует картинкой — с маршрута", async () => {
    const slot = open(demo(`\`\`\`md\n![Код](${STORED})\n\`\`\`\n\nи строкой \`![Строка](${STORED})\``));
    const card = await slot.findByRole("group", { name: "Демонстрация" });
    await waitFor(() => expect(sources(card)).toEqual([briefImageUrl("thr_1", STORED)]));
    expect(card.querySelector("pre")?.textContent).toBe(`![Код](${STORED})`);
  });
});
