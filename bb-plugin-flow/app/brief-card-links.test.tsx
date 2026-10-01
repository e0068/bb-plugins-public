// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AnswerRecord, DecisionBrief, decisionsRpcContract } from "../shared/contract";
import { ENVIRONMENT, threadFiles, workspacePreview } from "./file-roots-fixture";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const brief: DecisionBrief = {
  id: "dec_links",
  threadId: "thr_1",
  title: "Ссылки в тексте брифа",
  createdAt: "2026-10-01T00:00:00.000Z",
  kind: "brief",
  revocable: true,
  setup: { criteria: ["Правило записано в [CLAUDE.md](docs/rules/CLAUDE.md)"] },
  questions: [
    {
      id: "scope",
      kind: "fork",
      allowOwn: false,
      question: "Чинить [виджет](app/widget.tsx)?",
      context: "Текст выводит [Titles (заголовок брифа) — parts.tsx](app/parts.tsx:42)",
      options: [
        { id: "a", action: "Править [brief-card.tsx](app/brief-card.tsx)", description: "Ядро — [inline-links.ts](core/inline-links.ts)", recommended: true },
        { id: "b", action: "Не править", recommended: false },
      ],
    },
    { id: "read", kind: "confirm", allowOwn: false, question: "Так?", options: [{ id: "yes", action: "Да, как в [README.md](README.md)", recommended: true }] },
  ],
};

/** Вступление агента на экране только у брифа прежнего вида. */
const legacy: DecisionBrief = {
  id: "dec_links_legacy",
  threadId: "thr_1",
  title: "Бриф прежнего вида",
  intro: "Разбор — в [spec.md](docs/specs/spec.md)",
  createdAt: "2026-10-01T00:00:00.000Z",
  kind: "brief",
  revocable: true,
  questions: [{ id: "go", kind: "yesno", allowOwn: false, question: "Делать?", options: [{ id: "yes", action: "Да", recommended: true }, { id: "no", action: "Нет", recommended: false }] }],
};

const demo: DecisionBrief = {
  id: "dec_links_demo",
  threadId: "thr_1",
  title: "Итог работы",
  createdAt: "2026-10-01T00:00:00.000Z",
  kind: "brief",
  revocable: true,
  launched: true,
  questions: [],
  outcome: {
    stage: "demo",
    final: true,
    done: ["Разбор в [inline-links.ts](core/inline-links.ts)"],
    pending: [{ text: "Хук", why: "снят в [брифе](docs/flows/brief.md)" }],
    notes: "Подробности — [spec.md](docs/specs/spec.md)",
    results: [{ label: "widget.tsx", target: "app/widget.tsx" }],
  },
};

const open = (shown: DecisionBrief, answer: AnswerRecord | null = null) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: shown.id }, source: `::decision{id="${shown.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief: shown, answer }), answerBrief: () => ({ kind: "not_found" }), ...({ threadFiles } as object) } },
  );

type Slot = ReturnType<typeof open>;
const click = async (slot: Slot, name: string) => fireEvent.click(await slot.findByRole("link", { name }));

describe("ссылки [текст](путь) в брифе", () => {
  it("вопрос и пояснение — ссылки с текстом, клик открывает файл, номер строки доходит до превью", async () => {
    const slot = open(brief);
    await click(slot, "виджет");
    expect(slot.navigateCalls).toContainEqual(workspacePreview("app/widget.tsx"));
    await click(slot, "Titles (заголовок брифа) — parts.tsx");
    expect(slot.navigateCalls).toContainEqual({
      method: "experimental_openFilePreview",
      options: { target: { kind: "workspace", environmentId: ENVIRONMENT, path: "app/parts.tsx" }, location: { kind: "line", line: 42, column: null } },
    });
    expect(slot.getByRole("group", { name: "Чинить виджет?" }).textContent).not.toContain("](");
  });

  it("клик по ссылке в варианте открывает файл и не выбирает вариант", async () => {
    const slot = open(brief);
    await click(slot, "brief-card.tsx");
    await click(slot, "inline-links.ts");
    expect(slot.navigateCalls).toContainEqual(workspacePreview("app/brief-card.tsx"));
    expect(slot.navigateCalls).toContainEqual(workspacePreview("core/inline-links.ts"));
    expect(slot.getByRole("button", { name: /Править brief-card\.tsx/ }).getAttribute("aria-pressed")).toBe("false");
  });

  it("пункт критерия со ссылкой виден ссылкой, клик мимо неё открывает правку", async () => {
    const slot = open(brief);
    await click(slot, "CLAUDE.md");
    expect(slot.navigateCalls).toContainEqual(workspacePreview("docs/rules/CLAUDE.md"));
    const field = slot.getByRole("textbox", { name: "Пункт 1" });
    expect(field.className).toContain("sr-only");
    fireEvent.click(slot.getByRole("link", { name: "CLAUDE.md" }).closest("[data-linked-item]")!);
    expect(field.className).not.toContain("sr-only");
    expect(slot.queryByRole("link", { name: "CLAUDE.md" })).toBeNull();
  });

  it("вариант подтверждения — ссылкой, клик по ней не выбирает вариант", async () => {
    const slot = open(brief);
    await click(slot, "README.md");
    expect(slot.navigateCalls).toContainEqual(workspacePreview("README.md"));
    expect(slot.getByRole("button", { name: /Да, как в README\.md/ }).getAttribute("aria-pressed")).toBe("false");
  });

  it("вступление агента — ссылкой", async () => {
    const slot = open(legacy);
    await click(slot, "spec.md");
    expect(slot.navigateCalls).toContainEqual(workspacePreview("docs/specs/spec.md"));
  });

  it("пункты, причины и заметки демонстрации — ссылками", async () => {
    const slot = open(demo);
    const card = within(await slot.findByRole("group", { name: "Демонстрация" }));
    for (const [name, path] of [
      ["inline-links.ts", "core/inline-links.ts"],
      ["брифе", "docs/flows/brief.md"],
      ["spec.md", "docs/specs/spec.md"],
    ] as const) {
      fireEvent.click(await card.findByRole("link", { name }));
      expect(slot.navigateCalls).toContainEqual(workspacePreview(path));
    }
  });
});
