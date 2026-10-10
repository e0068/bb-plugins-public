// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DecisionAnswer, DecisionBrief, MentionItem, decisionsRpcContract, dispatchRpcContract, mentionsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const brief: DecisionBrief = {
  id: "dec_mentions",
  threadId: "thr_1",
  title: "Поиск по знакам",
  createdAt: "2026-10-10T10:00:00.000Z",
  kind: "brief",
  setup: { criteria: ["Тесты зелёные"] },
  questions: [{ id: "q", kind: "fork", question: "Как делать?", allowOwn: false, options: [{ id: "a", action: "Так", recommended: false }] }],
};

const SKILLS: MentionItem[] = [
  { kind: "skill", name: "spec", insert: "spec", description: "Спецификация задачи" },
  { kind: "command", name: "compact", insert: "compact" },
];
const FILES: MentionItem[] = [{ kind: "file", name: "brief-card.tsx", insert: "bb-plugin-flow/app/brief-card.tsx", description: "bb-plugin-flow/app/brief-card.tsx" }];

type Asked = { threadId?: string; trigger: "/" | "@"; query: string };

const open = (asked: Asked[] = [], sent: DecisionAnswer[] = []) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract & typeof dispatchRpcContract & typeof mentionsRpcContract>(
    app.messageDirectives[0]!,
    {
      attributes: { id: brief.id },
      source: `::decision{id="${brief.id}"}`,
      message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null },
      openWorkspaceFile: () => true,
    },
    {
      rpc: {
        getBrief: () => ({ kind: "found", brief, answer: null }),
        answerBrief: ({ answer }) => {
          sent.push(answer);
          return { kind: "not_found" };
        },
        getDispatchPlace: () => ({ place: "here" as const }),
        listProjects: () => ({ kind: "unavailable" as const }),
        mentions: (input) => {
          asked.push(input);
          return { kind: "found" as const, items: input.trigger === "/" ? SKILLS.filter((s) => s.name.includes(input.query)) : FILES };
        },
      },
    },
  );

type Slot = ReturnType<typeof open>;

/** Набор в поле: текст встаёт, курсор — в конце, как после нажатия клавиши. */
const type = (field: HTMLTextAreaElement, text: string) => {
  fireEvent.change(field, { target: { value: text } });
  field.setSelectionRange(text.length, text.length);
  fireEvent.keyUp(field);
};

const noteField = async (slot: Slot) => (await slot.findByRole("textbox", { name: "Дополнить бриф" })) as HTMLTextAreaElement;

describe("`/` в поле брифа — навыки и команды агента треда", () => {
  it("набор `/` и начала имени открывает под полем список, суженный по набранному, у треда брифа", async () => {
    const asked: Asked[] = [];
    const slot = open(asked);
    const field = await noteField(slot);
    field.focus();
    type(field, "/sp");
    const list = await slot.findByRole("listbox", { name: "Навыки и команды" });
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["/specСпецификация задачи"]);
    expect(asked.at(-1)).toEqual({ threadId: "thr_1", trigger: "/", query: "" });
  });

  it("Enter вставляет выбранное с пробелом и не отправляет бриф", async () => {
    const sent: DecisionAnswer[] = [];
    const slot = open([], sent);
    const field = await noteField(slot);
    field.focus();
    type(field, "сделай /sp");
    await slot.findByRole("listbox");
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(field.value).toBe("сделай /spec "));
    expect(field.selectionStart).toBe("сделай /spec ".length);
    expect(slot.queryByRole("listbox")).toBeNull();
    expect(sent).toEqual([]);
  });

  it("стрелка вниз выбирает следующую строку", async () => {
    const slot = open();
    const field = await noteField(slot);
    field.focus();
    type(field, "/");
    await slot.findByRole("listbox");
    fireEvent.keyDown(field, { key: "ArrowDown" });
    expect(slot.getByRole("option", { selected: true }).textContent).toBe("/compact");
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(field.value).toBe("/compact "));
  });

  it("Enter сразу после набора, пока ответ на новое слово в пути, вставляет набранное, а не первую строку прежнего списка", async () => {
    const slot = open();
    const field = await noteField(slot);
    field.focus();
    type(field, "/");
    await slot.findByRole("listbox");
    type(field, "/comp");
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(field.value).toBe("/compact "));
  });

  it("выбор того же, что уже набрано целиком, закрывает список и ставит курсор за словом", async () => {
    const slot = open();
    const field = await noteField(slot);
    field.focus();
    fireEvent.change(field, { target: { value: "/spec потом" } });
    field.setSelectionRange(5, 5);
    fireEvent.keyUp(field);
    await slot.findByRole("listbox");
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(slot.queryByRole("listbox")).toBeNull());
    expect(field.value).toBe("/spec потом");
    expect(field.selectionStart).toBe(6);
  });

  it("Esc закрывает список, не трогая текст", async () => {
    const slot = open();
    const field = await noteField(slot);
    field.focus();
    type(field, "/sp");
    await slot.findByRole("listbox");
    fireEvent.keyDown(field, { key: "Escape" });
    await waitFor(() => expect(slot.queryByRole("listbox")).toBeNull());
    expect(field.value).toBe("/sp");
  });

  it("знак внутри слова — путь `docs/tasks` — списка не открывает", async () => {
    const asked: Asked[] = [];
    const slot = open(asked);
    const field = await noteField(slot);
    field.focus();
    type(field, "docs/tasks");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(slot.queryByRole("listbox")).toBeNull();
    expect(asked).toEqual([]);
  });
});

describe("`@` в поле брифа — файлы и папки рабочей копии", () => {
  it("нажатие на строку вставляет путь со знаком", async () => {
    const slot = open();
    const field = await noteField(slot);
    field.focus();
    type(field, "глянь @brief");
    const list = await slot.findByRole("listbox", { name: "Файлы и папки" });
    fireEvent.click(within(list).getByRole("option"));
    await waitFor(() => expect(field.value).toBe("глянь @bb-plugin-flow/app/brief-card.tsx "));
  });
});

describe("другие поля брифа", () => {
  it.each(["Свой ответ", "Пункт 1"])("«%s» тоже открывает список по `/`", async (name) => {
    const slot = open();
    const field = (await slot.findByRole("textbox", { name })) as HTMLTextAreaElement;
    field.focus();
    type(field, "/comp");
    const list = await slot.findByRole("listbox", { name: "Навыки и команды" });
    expect(within(list).getByRole("option").textContent).toBe("/compact");
  });
});
