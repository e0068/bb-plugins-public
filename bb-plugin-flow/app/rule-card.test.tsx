// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuleRecord, rulesRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const MEMORY = "/Users/me/.claude/projects/-Users-me-repo/memory";

const rule: RuleRecord = {
  id: "rul_1",
  threadId: "thr_1",
  createdAt: "2026-10-22T12:00:00.000Z",
  baseSha256: null,
  text: "Подписи развилок — словами владельца",
  why: "Тумблер «outcome.rules» вы не поняли.",
  target: { kind: "memory", path: `${MEMORY}/fork-labels.md` },
  mode: "create",
  content: "Подписи развилок — словами владельца.\n",
  index: "- [Подписи](fork-labels.md)",
  similar: [{ kind: "memory", path: `${MEMORY}/demo-links.md`, quote: "«Ссылки демо — в bb и в своём браузере»", note: "почти то же — уже в памяти", same: true }],
};

const open = (decideRule = vi.fn((input: { decision: string; text?: string }) => ({ kind: "found" as const, rule: { ...rule, decision: input.decision === "write" ? { kind: "written" as const, at: rule.createdAt, text: input.text ?? rule.text, paths: [rule.target.path] } : { kind: "declined" as const, at: rule.createdAt } } }))) => {
  const slot = renderSlot<PluginMessageDirectiveProps, typeof rulesRpcContract>(
    app.messageDirectives.find((d) => d.id === "rule")!,
    { attributes: { id: rule.id }, source: `::rule{id="${rule.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: null },
    { rpc: { getRule: () => ({ kind: "found", rule }), decideRule } },
  );
  return { slot, decideRule };
};

describe("виджет правила", () => {
  it("показывает правило, место записи и похожее место с пометкой дубля", async () => {
    const { slot } = open();
    expect(((await slot.findByRole("textbox", { name: "Текст правила" })) as HTMLTextAreaElement).value).toBe(rule.text);
    expect(slot.getByText("Правило · в память")).toBeTruthy();
    expect(slot.getByText("fork-labels.md")).toBeTruthy();
    expect(slot.getByText("новый файл")).toBeTruthy();
    expect(slot.getByText("почти то же — уже в памяти").className).toContain("text-destructive");
  });

  it("навык подписан своей папкой: в чипе его имя, в строке — папка/SKILL.md", async () => {
    const skill = "/Users/me/.claude/skills/flow-demo/SKILL.md";
    const { index: _index, ...rest } = rule;
    const slot = renderSlot<PluginMessageDirectiveProps, typeof rulesRpcContract>(
      app.messageDirectives.find((d) => d.id === "rule")!,
      { attributes: { id: rule.id }, source: `::rule{id="${rule.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: null },
      { rpc: { getRule: () => ({ kind: "found", rule: { ...rest, target: { kind: "skill", path: skill }, mode: "append" } }), decideRule: () => ({ kind: "not_found" }) } },
    );
    expect(await slot.findByText("Навык flow-demo")).toBeTruthy();
    expect(slot.getByText("flow-demo/SKILL.md")).toBeTruthy();
  });

  it("замена: в «Куда» — «заменить», в диффе уходящие строки с минусом над новыми с плюсом", async () => {
    const { index: _index, ...rest } = rule;
    const slot = renderSlot<PluginMessageDirectiveProps, typeof rulesRpcContract>(
      app.messageDirectives.find((d) => d.id === "rule")!,
      { attributes: { id: rule.id }, source: `::rule{id="${rule.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: null },
      { rpc: { getRule: () => ({ kind: "found", rule: { ...rest, mode: "replace", replaces: "Подписи — как в схеме.\n" } }), decideRule: () => ({ kind: "not_found" }) } },
    );
    expect(await slot.findByText("заменить")).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Показать, что изменится" }));
    expect(slot.getByText("· замена")).toBeTruthy();
    const marks = [...slot.container.querySelectorAll("[data-diff-removed], [data-diff-added]")].map((line) => line.textContent);
    expect(marks).toEqual(["- Подписи — как в схеме.", "+ Подписи развилок — словами владельца."]);
  });

  it("что изменится — свёрнуто, раскрывается файлом и строкой оглавления", async () => {
    const { slot } = open();
    fireEvent.click(await slot.findByRole("button", { name: "Показать, что изменится" }));
    expect(slot.getByText("+ Подписи развилок — словами владельца.")).toBeTruthy();
    expect(slot.getByText("+ - [Подписи](fork-labels.md)")).toBeTruthy();
  });

  it("«Записать» с поправленным текстом шлёт его серверу, кнопки сменяет строка исхода", async () => {
    const { slot, decideRule } = open();
    fireEvent.change(await slot.findByRole("textbox", { name: "Текст правила" }), { target: { value: "Подписи — тем, что видно" } });
    fireEvent.click(slot.getByRole("button", { name: "Записать" }));
    await waitFor(() => expect(slot.getByRole("status").textContent).toContain("Записано"));
    expect(decideRule).toHaveBeenCalledWith(expect.objectContaining({ id: "rul_1", decision: "write", text: "Подписи — тем, что видно" }));
    expect(slot.queryByRole("button", { name: "Записать" })).toBeNull();
    expect(slot.getByText("Подписи — тем, что видно")).toBeTruthy();
  });

  it("«Не записывать» — без текста правки, исход «Не записано»", async () => {
    const { slot, decideRule } = open();
    fireEvent.click(await slot.findByRole("button", { name: "Не записывать" }));
    await waitFor(() => expect(slot.getByRole("status").textContent).toContain("Не записано"));
    expect(decideRule.mock.calls[0]?.[0]).not.toHaveProperty("text");
  });
});
