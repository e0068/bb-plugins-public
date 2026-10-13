// @vitest-environment jsdom
import { act, cleanup, fireEvent } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DecisionBrief, PrototypeState, decisionsRpcContract, prototypeRpcContract } from "../shared/contract";
import { threadFiles } from "./file-roots-fixture";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const URL_ = "https://e0068--8766.getbb.app/sample.html";
const demo: DecisionBrief = {
  id: "dec_proto",
  threadId: "thr_1",
  title: "Демонстрация — прототип",
  createdAt: "2026-10-13T00:00:00.000Z",
  kind: "brief",
  questions: [],
  outcome: { stage: "demo", final: false, next: "Approval", done: ["Прототип"], pending: [], results: [{ label: "p", target: URL_ }], prototype: { url: URL_ } },
};
const forks = [{ id: "side", label: "Кнопка отправки", options: [{ value: "right", label: "Справа" }, { value: "left", label: "Слева" }] }];

const open = (stored: PrototypeState | null | Promise<{ state: PrototypeState | null }> = null) => {
  const saves: unknown[] = [];
  const slot = renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract & typeof prototypeRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: demo.id }, source: `::decision{id="${demo.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    {
      rpc: {
        getBrief: () => ({ kind: "found", brief: demo, answer: null }),
        answerBrief: () => ({ kind: "not_found" }),
        getPrototype: () => (stored instanceof Promise ? stored : { state: stored }),
        savePrototype: (input: { edit: PrototypeState }) => (saves.push(input.edit), { state: { ...input.edit, sentChoices: {} } }),
        ...({ threadFiles } as object),
      } as never,
    },
  );
  return { slot, saves };
};

/** Окно прототипа и сообщение от его страницы — так, как его увидит виджет. */
const frameOf = async (slot: ReturnType<typeof open>["slot"]) => {
  const frame = (await slot.findByTitle("Прототип")) as HTMLIFrameElement;
  const post = vi.spyOn(frame.contentWindow!, "postMessage");
  const say = (data: unknown, source: Window | null = frame.contentWindow) =>
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data: { source: "bb-prototype", ...(data as object) }, source }));
    });
  return { frame, post, say };
};

describe("виджет «Прототип» под Демонстрацией", () => {
  it("окно открывает страницу прототипа, у адреса — кнопка комментариев агенту", async () => {
    const { slot } = open();
    const { frame } = await frameOf(slot);
    expect(frame.getAttribute("src")).toBe(URL_);
    expect(await slot.findByRole("button", { name: "Комментарий агенту" })).toBeTruthy();
  });

  it("развилки, которые прислала страница, встают сегментами; выбор в виджете переключает страницу", async () => {
    const { slot } = open();
    const { post, say } = await frameOf(slot);
    await say({ type: "ready", forks });
    const left = await slot.findByRole("tab", { name: "Слева" });
    fireEvent.mouseDown(left);
    expect(post).toHaveBeenCalledWith({ source: "bb-prototype", type: "set", fork: "side", value: "left" }, "*");
  });

  it("выбор на странице переключает сегмент и запоминается; чужое окно виджет не слушает", async () => {
    const { slot, saves } = open();
    const { say } = await frameOf(slot);
    await say({ type: "ready", forks });
    await say({ type: "choice", fork: "side", value: "right" }, window);
    expect((await slot.findByRole("tab", { name: "Справа" })).getAttribute("aria-selected")).toBe("true");
    await say({ type: "choice", fork: "side", value: "left" });
    expect((await slot.findByRole("tab", { name: "Слева" })).getAttribute("aria-selected")).toBe("true");
    await vi.waitFor(() => expect(saves.at(-1)).toMatchObject({ choices: { side: "left" } }));
  });

  it("после перезагрузки страница получает сохранённый выбор", async () => {
    const { slot } = open({ forks, choices: { side: "left" }, sentChoices: {}, comments: [] });
    const { post, say } = await frameOf(slot);
    await vi.waitFor(() => expect(slot.queryByRole("tab", { name: "Слева" })?.getAttribute("aria-selected")).toBe("true"));
    await say({ type: "ready", forks });
    expect(post).toHaveBeenCalledWith({ source: "bb-prototype", type: "restore", choices: { side: "left" }, embedded: true }, "*");
  });

  it("окно открывается только после того, как память прочитана: ранний ответ страницы не стирает сохранённый выбор", async () => {
    let load: (value: { state: PrototypeState }) => void = () => undefined;
    const { slot, saves } = open(new Promise((resolve) => (load = resolve)));
    await slot.findByRole("button", { name: "Комментарий агенту" });
    expect(slot.queryByTitle("Прототип")).toBeNull();
    await act(async () => load({ state: { forks, choices: { side: "left" }, sentChoices: {}, comments: [] } }));
    const { post, say } = await frameOf(slot);
    await say({ type: "ready", forks });
    expect(post).toHaveBeenCalledWith({ source: "bb-prototype", type: "restore", choices: { side: "left" }, embedded: true }, "*");
    await vi.waitFor(() => expect(saves.at(-1)).toMatchObject({ choices: { side: "left" } }));
  });

  it("комментарий к месту: кнопка просит клик, страница называет место, текст встаёт строкой и уходит в память", async () => {
    const { slot, saves } = open();
    const { post, say } = await frameOf(slot);
    await say({ type: "ready", forks });
    fireEvent.click(await slot.findByRole("button", { name: "Комментарий агенту" }));
    expect(post).toHaveBeenCalledWith({ source: "bb-prototype", type: "pick" }, "*");
    expect(await slot.findByText("Кликните по месту в окне, к которому комментарий")).toBeTruthy();
    await say({ type: "picked", label: "кнопка «Отправить»" });
    const field = await slot.findByRole("textbox", { name: "Комментарий агенту" });
    fireEvent.change(field, { target: { value: "Сделай кнопку синей" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(await slot.findByText("Сделай кнопку синей")).toBeTruthy();
    expect(slot.getByText("кнопка «Отправить»")).toBeTruthy();
    await vi.waitFor(() => expect(saves.at(-1)).toMatchObject({ comments: [{ text: "Сделай кнопку синей", at: "кнопка «Отправить»" }] }));
  });
});
