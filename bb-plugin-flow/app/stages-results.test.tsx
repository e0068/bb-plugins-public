// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { report, stagedBrief } from "../core/stages-fixtures";
import type { DecisionBrief, decisionsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const STORAGE = "/Users/me/.bb/thread-storage/thr_1";
const PROTOTYPE = `${STORAGE}/CEL-131/prototype.html`;

const brief = stagedBrief([
  report("task", { state: "done", results: [{ label: "BBPL-1", target: "docs/tasks/BBPL-1.md" }] }),
  report("spec", { state: "done", results: [{ label: "prototype.html", target: PROTOTYPE }, { label: "spec.md", target: "docs/specs/spec.md" }] }),
  report("plan", { recommended: true }),
]);

const open = (openWorkspaceFile: PluginMessageDirectiveProps["openWorkspaceFile"] = () => true, b: DecisionBrief = brief) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract & { threadStorage: never }>(
    app.messageDirectives[0]!,
    { attributes: { id: b.id }, source: `::decision{id="${b.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile },
    {
      rpc: {
        getBrief: () => ({ kind: "found", brief: b, answer: null }),
        answerBrief: () => ({ kind: "not_found" }),
        threadStorage: (() => ({ kind: "found", hostId: "local", storageRootPath: STORAGE })) as never,
      },
    },
  );

type Slot = ReturnType<typeof open>;

const results = async (slot: Slot) => {
  await slot.findByRole("group", { name: "Ответ на бриф" });
  fireEvent.click(within(slot.container.querySelector<HTMLElement>('[data-stage="spec"]')!).getByRole("button", { name: "Спецификация" }));
  return within(slot.getByRole("group", { name: "Спецификация: результаты" }));
};

describe("результаты сделанного этапа", () => {
  it("результат — одна строка: сперва имя файла, за ним путь", async () => {
    const slot = open();
    await results(slot);
    const rows = [...slot.container.querySelectorAll<HTMLElement>("[data-result-row]")];
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getAllByRole("button").map((b) => b.textContent)).toEqual(["prototype.html", PROTOTYPE]);
  });

  it("имя файла из хранилища треда открывает его превью bb файлом хранилища", async () => {
    const slot = open();
    fireEvent.click((await results(slot)).getByRole("button", { name: /^prototype\.html/ }));
    await waitFor(() => expect(slot.navigateCalls).toContainEqual({ method: "experimental_openFilePreview", options: { target: { kind: "thread-storage", threadId: "thr_1", path: "CEL-131/prototype.html" }, location: null } }));
  });

  it("имя файла с путём от корня дерева открывает его просмотрщиком дерева", async () => {
    const opened = vi.fn(() => true);
    const slot = open(opened);
    fireEvent.click((await results(slot)).getByRole("button", { name: /^spec\.md/ }));
    expect(opened).toHaveBeenCalledWith("docs/specs/spec.md");
  });

  it("клик по пути копирует его в буфер и на миг показывает «Путь скопирован»", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const panel = await results(open());
    fireEvent.click(panel.getByRole("button", { name: `Скопировать путь ${PROTOTYPE}` }));
    expect(writeText).toHaveBeenCalledWith(PROTOTYPE);
    expect((await panel.findAllByText("Путь скопирован")).length).toBeGreaterThan(0);
  });

  it("буфер отказал или его нет — на месте пути «Не удалось скопировать путь»", async () => {
    for (const clipboard of [{ writeText: vi.fn(async () => Promise.reject(new Error("denied"))) }, undefined]) {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: clipboard });
      const slot = open();
      const panel = await results(slot);
      fireEvent.click(panel.getByRole("button", { name: `Скопировать путь ${PROTOTYPE}` }));
      expect((await panel.findAllByText("Не удалось скопировать путь")).length).toBeGreaterThan(0);
      cleanup();
    }
  });
});
