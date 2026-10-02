// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

import type { DecisionBrief, decisionsRpcContract } from "../shared/contract";
import { emptyDraft } from "./draft";
import { encodeDraft } from "./draft-storage";
import { threadFiles } from "./file-roots-fixture";

const app = await loadPluginApp(() => import("../app"));

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const brief: DecisionBrief = {
  id: "dec_returned",
  threadId: "thr_1",
  title: "Бриф",
  createdAt: "2026-10-02T10:00:00.000Z",
  kind: "brief",
  questions: [
    { id: "route", question: "Куда идём?", kind: "fork", allowOwn: false, options: [
      { id: "left", action: "Налево", recommended: true, description: "Короче." },
      { id: "right", action: "Направо", recommended: false, description: "Дольше." },
    ] },
  ],
};

type Rpc = NonNullable<Parameters<typeof renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>>[2]>["rpc"];

const render = (rpc: Record<string, unknown>) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    {
      attributes: { id: brief.id },
      source: `::decision{id="${brief.id}"}`,
      message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null },
      openWorkspaceFile: null,
    },
    { rpc: { ...({ threadFiles } as object), answerBrief: () => ({ kind: "not_found" }), ...rpc } as unknown as Rpc },
  );

const pressed = (scope: ReturnType<typeof within>) =>
  scope.queryAllByRole("button").filter((b: HTMLElement) => b.getAttribute("aria-pressed") === "true").map((b: HTMLElement) => b.textContent);

describe("бриф, возвращённый сообщением в чат", () => {
  it("в ленте от него одна строка: вопросов и кнопки отправки нет", async () => {
    const slot = render({ getBrief: () => ({ kind: "found", brief, answer: null, returned: true }) });
    expect(await slot.findByText(/Бриф вернулся агенту/)).toBeTruthy();
    expect(slot.queryByRole("group", { name: "Куда идём?" })).toBeNull();
  });

  it("бриф взамен возвращённого открывается с выбором владельца, а не с рекомендацией", async () => {
    const restored = { draft: encodeDraft({ ...emptyDraft(), entries: { route: { optionIds: ["right"], own: "", picked: ["right"] } } }) };
    const slot = render({ getBrief: () => ({ kind: "found", brief: { ...brief, restored }, answer: null }) });
    const question = within(await slot.findByRole("group", { name: "Куда идём?" }));
    expect(pressed(question).join(" ")).toMatch(/Направо/);
  });

  it("выбор владельца уходит черновиком на сервер: его подхватит бриф взамен возвращённого", async () => {
    const saved: string[] = [];
    const slot = render({
      getBrief: () => ({ kind: "found", brief, answer: null }),
      saveBriefDraft: ({ draft }: { draft: string }) => (saved.push(draft), { kind: "saved" }),
    });
    const question = within(await slot.findByRole("group", { name: "Куда идём?" }));
    fireEvent.click(question.getByRole("button", { name: /Направо/ }));
    await waitFor(() => expect(saved.length).toBeGreaterThan(0));
    expect(JSON.parse(saved.at(-1)!).entries.route.optionIds).toEqual(["right"]);
  });
});
