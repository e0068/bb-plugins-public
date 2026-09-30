// @vitest-environment jsdom
// Плитка «Журнал» итога прогона: файлы журнала, которые прогон оставил в дереве треда, ссылками bb.
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { DecisionBrief } from "../shared/contract";
import { ENVIRONMENT, threadFiles, workspacePreview } from "./file-roots-fixture";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const brief: DecisionBrief = {
  id: "dec_demo",
  threadId: "thr_1",
  title: "Демонстрация",
  createdAt: "2026-09-19T10:00:00.000Z",
  kind: "brief",
  questions: [],
  outcome: { stage: "demo", final: true, done: ["Итог в ленте"], pending: [], results: [{ label: "prototype.html", target: "docs/assets/x/prototype.html" }] },
  stages: { list: [{ ...builtinStage("demo", []), name: "Демонстрация" }], minButtonWidth: 160 },
};

const frozen = (patch: Record<string, unknown> = {}) => ({
  threadId: "thr_1",
  done: 1,
  total: 1,
  planned: null,
  environmentId: ENVIRONMENT,
  summary: { startedAt: "2026-09-19T10:00:00.000Z", finishedAt: "2026-09-19T13:00:00.000Z", minutes: 60, wallMinutes: 180, idleMinutes: 120, cost: 10, stages: 1, skipped: 0, executors: [] },
  stages: [{ id: "demo", kind: "demo", name: "Демонстрация", executor: "self", state: "done", results: [], minutes: 4, cost: 0.5, number: 1 }],
  ...patch,
});

const open = (view: unknown) =>
  renderSlot<PluginMessageDirectiveProps, never>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    {
      rpc: {
        getBrief: () => ({ kind: "found", brief, answer: null }),
        getDispatchPlace: () => ({ place: "here" }),
        listProjects: () => ({ kind: "found" as const, projects: [] }),
        getRunSummary: ({ briefId }: { briefId: string }) => (briefId === "dec_demo" ? view : null),
        threadFiles,
      } as never,
      settings: { language: "Русский" },
    },
  );

const summaryOf = async (slot: { container: HTMLElement }) => {
  await waitFor(() => expect(slot.container.querySelector("[data-run-summary]")).not.toBeNull());
  return within(slot.container.querySelector<HTMLElement>("[data-run-summary]")!);
};

describe("журнал в итоге прогона", () => {
  it("плитка «Журнал» перечисляет файлы журнала по порядку, подписанные именем файла", async () => {
    const tiles = await summaryOf(open(frozen({ journal: ["docs/flows/mehanizm-funkcii-volna-0.md", "docs/flows/mehanizm-funkcii-volna-0-demonstraciya.md"] })));
    expect(tiles.getByText("Журнал")).toBeTruthy();
    const names = (await tiles.findAllByRole("link")).map((link) => link.textContent).filter((text) => text?.endsWith(".md"));
    expect(names).toEqual(["mehanizm-funkcii-volna-0.md", "mehanizm-funkcii-volna-0-demonstraciya.md"]);
  });

  it("клик по файлу журнала открывает его превью в дереве треда", async () => {
    const slot = open(frozen({ journal: ["docs/flows/mehanizm-funkcii-volna-0.md"] }));
    const tiles = await summaryOf(slot);
    fireEvent.click(await tiles.findByRole("link", { name: "mehanizm-funkcii-volna-0.md" }));
    expect(slot.navigateCalls).toContainEqual(workspacePreview("docs/flows/mehanizm-funkcii-volna-0.md"));
  });

  it("прогон без файлов журнала так и говорит", async () => {
    const tiles = await summaryOf(open(frozen({ journal: [] })));
    expect(tiles.getByText("Журнал")).toBeTruthy();
    expect(tiles.getByText("Файлов журнала нет")).toBeTruthy();
  });

  it("журнал не прочитался — плитки журнала нет", async () => {
    const tiles = await summaryOf(open(frozen()));
    expect(tiles.queryByText("Журнал")).toBeNull();
  });
});
