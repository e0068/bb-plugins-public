// @vitest-environment jsdom
//
// Обещания темы окна на фронте: форма в настройках и в Side Pane, правка уходит
// на сервер, сохранение с заменой занятого имени, живая таблица в <head>.
// Правила самих значений и CSS — core/theme.test.ts.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot, type RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";

import { THEME_CHANGED, themeCss, type ThemeValues } from "../core/theme";
import type { SaveResult, themeRpcContract } from "../shared/contract";

afterEach(cleanup);

// В jsdom нет canvas: подсказки цветов темы bb пустые, как и задумано без него.
HTMLCanvasElement.prototype.getContext = (() => null) as never;

const app = await loadPluginApp(() => import("../app"));
// Модуль с хуками SDK — только после загрузки приложения: она ставит рантайм плагина.
const { THEME_STYLE_MARKER } = await import("./theme-style");
const settings = app.settingsSections.find((s) => s.id === "theme")!;
const pane = app.threadPanelActions.find((a) => a.id === "theme")!;
const overlay = app.appOverlays.find((o) => o.id === "theme")!;

type Options = RenderSlotOptions<typeof themeRpcContract>;

/** Сервер в памяти: значения и ответы сохранения по очереди. */
function memoryRpc(initial: ThemeValues, answers: SaveResult[] = []): NonNullable<Options["rpc"]> {
  let values = initial;
  return {
    get: () => values,
    set: (next) => {
      values = next as ThemeValues;
      return { ok: true as const };
    },
    saveTheme: () => answers.shift() ?? { status: "saved", id: "x", message: null },
  };
}

const sheets = () => [...document.head.querySelectorAll(`style[${THEME_STYLE_MARKER}]`)].map((s) => s.textContent);

describe("регистрации", () => {
  it("форма темы — и раздел настроек, и действие правой панели, а оверлей применяет тему", () => {
    expect(settings.title).toBe("Тема окна");
    expect(pane.title).toBe("Тема окна");
    expect(pane.component).toBe(settings.component);
    expect(overlay).toBeDefined();
  });
});

describe("форма темы", () => {
  it("правка hex уходит на сервер, сброс возвращает цвет текущей темы", async () => {
    const view = renderSlot(settings, {}, { rpc: memoryRpc({}) } satisfies Options);
    const field = await view.findByLabelText("Акцент, тёмная тема");

    fireEvent.change(field, { target: { value: "#9DB6C6" } });
    await waitFor(() => expect(view.rpcCalls.filter((c) => c.method === "set").at(-1)?.input).toEqual({ dark: { primary: "#9db6c6" } }));

    fireEvent.click(view.getByLabelText("Акцент, тёмная тема: вернуть цвет темы"));
    await waitFor(() => expect(view.rpcCalls.filter((c) => c.method === "set").at(-1)?.input).toEqual({}));
  });

  it("недопустимое значение подсвечено и на сервер не уходит", async () => {
    const view = renderSlot(settings, {}, { rpc: memoryRpc({}) } satisfies Options);
    const radius = await view.findByLabelText("Кнопки и поля");
    fireEvent.change(radius, { target: { value: "99" } });
    expect(radius.getAttribute("aria-invalid")).toBe("true");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(view.rpcCalls.filter((c) => c.method === "set")).toEqual([]);
  });

  it("в Side Pane та же форма с теми же значениями", async () => {
    const view = renderSlot(pane, { threadId: "thr_1", params: null }, { rpc: memoryRpc({ radius: 6 }) } satisfies Options);
    expect(((await view.findByLabelText("Кнопки и поля")) as HTMLInputElement).value).toBe("6");
  });

  it("занятое имя предлагает заменить, и замена уходит с replace", async () => {
    const view = renderSlot(settings, {}, {
      rpc: memoryRpc({}, [
        { status: "exists", id: "ocean", message: null },
        { status: "saved", id: "ocean", message: null },
      ]),
    } satisfies Options);
    fireEvent.change(await view.findByLabelText("Название темы"), { target: { value: "ocean" } });
    fireEvent.click(view.getByText("Сохранить как тему"));
    fireEvent.click(await view.findByText("Заменить"));

    await view.findByText("Тема «ocean» сохранена и включена.");
    expect(view.rpcCalls.filter((c) => c.method === "saveTheme").map((c) => c.input)).toEqual([
      { name: "ocean", replace: false },
      { name: "ocean", replace: true },
    ]);
  });

  it("сохранение сначала отправляет неушедшую правку — в тему попадает то, что видно в форме", async () => {
    const view = renderSlot(settings, {}, { rpc: memoryRpc({}) } satisfies Options);
    fireEvent.change(await view.findByLabelText("Шрифт"), { target: { value: "14" } });
    fireEvent.change(view.getByLabelText("Название темы"), { target: { value: "big" } });
    fireEvent.click(view.getByText("Сохранить как тему"));

    await waitFor(() => expect(view.rpcCalls.map((c) => c.method)).toContain("saveTheme"));
    const methods = view.rpcCalls.map((c) => c.method);
    expect(methods.indexOf("set")).toBeLessThan(methods.indexOf("saveTheme"));
  });
});

describe("правка не теряется", () => {
  it("форму закрыли посреди паузы во вводе — правка всё равно уходит на сервер", async () => {
    const view = renderSlot(settings, {}, { rpc: memoryRpc({}) } satisfies Options);
    fireEvent.change(await view.findByLabelText("Текст, светлая тема"), { target: { value: "#112233" } });
    view.lifecycle.unmount();
    await waitFor(() => expect(view.rpcCalls.filter((c) => c.method === "set").at(-1)?.input).toEqual({ light: { ink: "#112233" } }));
  });

  it("сохранение ждёт запись, которая уже ушла, — тема берёт последние значения", async () => {
    const log: string[] = [];
    const memory = memoryRpc({});
    const rpc: NonNullable<Options["rpc"]> = {
      ...memory,
      set: async (next) => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        log.push("set done");
        return memory.set(next);
      },
      saveTheme: (input) => {
        log.push("saveTheme");
        return memory.saveTheme(input);
      },
    };
    const view = renderSlot(settings, {}, { rpc } satisfies Options);
    fireEvent.change(await view.findByLabelText("Шрифт"), { target: { value: "15" } });
    await waitFor(() => expect(view.rpcCalls.map((c) => c.method)).toContain("set"));
    fireEvent.change(view.getByLabelText("Название темы"), { target: { value: "big" } });
    fireEvent.click(view.getByText("Сохранить как тему"));

    await waitFor(() => expect(log).toEqual(["set done", "saveTheme"]));
  });

  it("запись не легла — сохранение не идёт и форма говорит об отказе", async () => {
    const memory = memoryRpc({});
    const rpc: NonNullable<Options["rpc"]> = {
      ...memory,
      set: () => {
        throw new Error("kv недоступно");
      },
    };
    const view = renderSlot(settings, {}, { rpc } satisfies Options);
    fireEvent.change(await view.findByLabelText("Шрифт"), { target: { value: "15" } });
    fireEvent.change(view.getByLabelText("Название темы"), { target: { value: "big" } });
    fireEvent.click(view.getByText("Сохранить как тему"));

    await view.findByText(/Не удалось сохранить тему: .*kv недоступно/u);
    expect(view.rpcCalls.map((c) => c.method)).not.toContain("saveTheme");
  });

  it("пустое поле шага отступов подсказывает шаг размеров", async () => {
    const view = renderSlot(settings, {}, { rpc: memoryRpc({ sizeStep: 6 }) } satisfies Options);
    expect((await view.findByLabelText("Паддинги")).getAttribute("placeholder")).toBe("6");
  });
});

describe("живое применение", () => {
  it("поздний ответ на старый запрос не перекрывает свежие значения", async () => {
    let calls = 0;
    const view = renderSlot(overlay, {}, {
      rpc: {
        get: async () => {
          calls += 1;
          if (calls === 1) await new Promise((resolve) => setTimeout(resolve, 80));
          return calls === 1 ? { radius: 6 } : { radius: 10 };
        },
        set: () => ({ ok: true as const }),
        saveTheme: () => ({ status: "saved", id: "x", message: null }),
      },
    } satisfies Options);
    await view.emitRealtime(THEME_CHANGED, {});
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(sheets()).toEqual([themeCss({ radius: 10 }, "live")]);
  });

  it("в <head> одна таблица темы, сигнал сервера её обновляет, а размонтирование убирает", async () => {
    let values: ThemeValues = { radius: 6 };
    const view = renderSlot(overlay, {}, {
      rpc: { get: () => values, set: () => ({ ok: true as const }), saveTheme: () => ({ status: "saved", id: "x", message: null }) },
    } satisfies Options);
    await waitFor(() => expect(sheets()).toEqual([themeCss({ radius: 6 }, "live")]));

    values = { radius: 10 };
    await view.emitRealtime(THEME_CHANGED, {});
    await waitFor(() => expect(sheets()).toEqual([themeCss({ radius: 10 }, "live")]));

    view.lifecycle.unmount();
    expect(sheets()).toEqual([]);
  });
});
