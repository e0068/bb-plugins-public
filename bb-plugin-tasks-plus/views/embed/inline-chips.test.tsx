// @vitest-environment jsdom
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("../../app"));

const task = {
  id: "01HZZZZZZZZZZZZZZZZZZZZZT1",
  projectId: "01HZZZZZZZZZZZZZZZZZZZZZP1",
  number: 28,
  key: "SSS-28",
  title: "Кнопка «Опубликовать» на сайте",
  description: "",
  status: "in_progress",
  priority: "none",
  dueDate: null,
  startDate: null,
  parentTaskId: null,
  position: 100,
  createdAt: "2026-11-08T00:00:00.000Z",
  updatedAt: "2026-11-08T00:00:00.000Z",
  labelIds: [],
  type: null,
  estimate: null,
  plannedMinutes: null,
  actualMinutes: null,
  budget: null,
  budgetLimit: null,
  cost: null,
  source: null,
};

/** Ответ агента так, как его рисует bb: колонка сообщения и абзацы markdown. */
const assistant = (html: string): string => `<div class="group/message w-full text-sm" data-message-column="">${html}</div>`;
/** Сообщение владельца: та же колонка, но группа сообщения — внутри неё. */
const owner = (html: string): string => `<div class="w-full" data-message-column=""><div class="group/message ml-auto">${html}</div></div>`;

const feed = (html: string): HTMLElement => {
  const element = document.createElement("div");
  element.innerHTML = html;
  document.body.append(element);
  return element;
};

const renderChips = (found: typeof task | null) =>
  renderSlot({ component: app.appOverlays.find((entry) => entry.id === "inline-task-chips")!.component }, {}, {
    rpc: { getTaskByKey: () => ({ task: found }) },
    context: { threadId: "thr_1" },
    openThreadPanel: () => true,
  });

const chipName = "SSS-28 — Кнопка «Опубликовать» на сайте, in progress — open in side panel";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("директива задачи посреди фразы в ответе агента", () => {
  it("становится чипом задачи на своём месте, текст вокруг остаётся", async () => {
    const message = feed(assistant('<p>Понял: ::task{key="SSS-28"} теперь про неё.</p>'));
    renderChips(task);
    const chip = await within(message).findByRole("button", { name: chipName });
    const paragraph = message.querySelector("p")!;
    expect(paragraph.contains(chip)).toBe(true);
    expect(paragraph.textContent).not.toContain("::task");
    expect(paragraph.textContent).toContain("Понял: ");
    expect(paragraph.textContent).toContain(" теперь про неё.");
  });

  it("клик по чипу открывает задачу в боковой панели треда", async () => {
    const message = feed(assistant('<p>см. ::task{key="SSS-28"}</p>'));
    const slot = renderChips(task);
    fireEvent.click(await within(message).findByRole("button", { name: chipName }));
    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "openThreadPanel",
      options: { actionId: "task", title: "SSS-28", params: { taskKey: "SSS-28" } },
    });
  });

  it("в inline code и в блоке кода директива остаётся текстом", async () => {
    const message = feed(
      assistant('<p>Пиши <code>::task{key="SSS-28"}</code> так.</p><pre><code>::task{key="SSS-28"} в строке</code></pre><p>а тут ::task{key="SSS-28"}</p>'),
    );
    renderChips(task);
    await within(message).findByRole("button", { name: chipName });
    expect(within(message).getAllByRole("button")).toHaveLength(1);
    expect(message.querySelector("p code")!.textContent).toBe('::task{key="SSS-28"}');
    expect(message.querySelector("pre")!.textContent).toBe('::task{key="SSS-28"} в строке');
  });

  it("сообщение владельца не трогается", async () => {
    const mine = feed(owner('<p>возьми ::task{key="SSS-28"}</p>'));
    const message = feed(assistant('<p>беру ::task{key="SSS-28"}</p>'));
    renderChips(task);
    await within(message).findByRole("button", { name: chipName });
    expect(mine.textContent).toBe('возьми ::task{key="SSS-28"}');
  });

  it("задача, которой нет на доске, остаётся исходным текстом директивы", async () => {
    const message = feed(assistant('<p>было ::task{key="NOPE-1"} тут</p>'));
    const slot = renderChips(null);
    await waitFor(() => expect(slot.inspection.rpcCalls.some((call) => call.method === "getTaskByKey")).toBe(true));
    await waitFor(() => expect(message.querySelector("p")!.textContent).toBe('было ::task{key="NOPE-1"} тут'));
    expect(within(message).queryAllByRole("button")).toHaveLength(0);
  });

  it("абзац, переписанный bb после замены, снова получает чип и не держит лишний хвост", async () => {
    const message = feed(assistant('<p>старт ::task{key="SSS-28"} хвост</p>'));
    renderChips(task);
    await within(message).findByRole("button", { name: chipName });
    // Стрим дописал абзац: React меняет данные своего текстового узла целиком.
    const paragraph = message.querySelector("p")!;
    paragraph.firstChild!.nodeValue = 'старт ::task{key="SSS-28"} хвост и ещё';
    await waitFor(() => expect(paragraph.textContent).not.toContain("::task"));
    expect(paragraph.textContent).toContain(" хвост и ещё");
    expect(within(message).getAllByRole("button", { name: chipName })).toHaveLength(1);
    expect(paragraph.textContent!.match(/хвост/g)).toHaveLength(1);
  });

  it("стрим, который дописывает абзац React bb, не пересобирает чип и не грузит задачу заново", async () => {
    // Абзац с одним ребёнком-строкой React bb обновляет через textContent: свой
    // текстовый узел он заменяет новым, а не правит на месте.
    const message = feed(assistant(""));
    const root = createRoot(message.querySelector("[data-message-column]")!);
    act(() => root.render(<p>{'Понял: ::task{key="SSS-28"} теперь'}</p>));
    const slot = renderChips(task);
    const chip = await within(message).findByRole("button", { name: chipName });
    for (const tail of [" про", " про неё", " про неё."]) {
      act(() => root.render(<p>{`Понял: ::task{key="SSS-28"} теперь${tail}`}</p>));
      await waitFor(() => expect(message.textContent).toBe(`Понял: SSS-28Кнопка «Опубликовать» на сайте теперь${tail}`));
    }
    expect(within(message).getByRole("button", { name: chipName })).toBe(chip);
    expect(slot.inspection.rpcCalls.filter((call) => call.method === "getTaskByKey")).toHaveLength(1);
    act(() => root.unmount());
  });

  it("ответ агента, пришедший в ленту целиком после старта, получает чип", async () => {
    feed(assistant("<p>без директив</p>"));
    renderChips(task);
    const later = feed(`<section><div>${assistant('<p>новый ответ ::task{key="SSS-28"}</p>')}</div></section>`);
    expect(await within(later).findByRole("button", { name: chipName })).toBeTruthy();
  });

  it("новый абзац в уже открытом ответе получает чип", async () => {
    const message = feed(assistant("<p>начало</p>"));
    renderChips(task);
    const column = message.querySelector("[data-message-column]")!;
    column.insertAdjacentHTML("beforeend", '<ul><li>пункт ::task{key="SSS-28"}</li></ul>');
    expect(await within(message).findByRole("button", { name: chipName })).toBeTruthy();
  });

  it("ссылка bb://tasks/<ключ> в карточке виджета открывает задачу сбоку, а не свой обработчик", async () => {
    const card = feed('<p>это <span class="mde-link mde-link-live" data-href="bb://tasks/SSS-28" role="link" tabindex="0">SSS-28</span> после</p>');
    let ownClicks = 0;
    card.querySelector(".mde-link")!.addEventListener("click", () => (ownClicks += 1));
    const slot = renderChips(task);
    await waitFor(() => expect(document.body.contains(card)).toBe(true));
    fireEvent.click(within(card).getByRole("link", { name: "SSS-28" }));
    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "openThreadPanel",
      options: { actionId: "task", title: "SSS-28", params: { taskKey: "SSS-28" } },
    });
    expect(ownClicks).toBe(0);
  });

  it("обычная ссылка не перехватывается", async () => {
    const card = feed('<p><a href="https://example.com">сайт</a></p>');
    const slot = renderChips(task);
    const link = within(card).getByRole("link", { name: "сайт" });
    link.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(link);
    expect(slot.inspection.navigateCalls).toEqual([]);
  });

  it("снятый плагин возвращает абзацу исходный текст", async () => {
    const message = feed(assistant('<p>Понял: ::task{key="SSS-28"} теперь.</p>'));
    const slot = renderChips(task);
    await within(message).findByRole("button", { name: chipName });
    slot.lifecycle.unmount();
    await waitFor(() => expect(message.querySelector("p")!.textContent).toBe('Понял: ::task{key="SSS-28"} теперь.'));
  });
});
