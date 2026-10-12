// @vitest-environment jsdom
// Встроенный список тредов bb: хост 0.46.0 не отдаёт слотам `Original`, поэтому Flow подключает фронтенд плагина `thread-list`
// по адресу из `/api/v1/plugins`, вызывает его `setup` с заглушкой приложения и забирает компонент, зарегистрированный в слоте.
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createBuiltinThreadListLoader, useBuiltinThreadList, type BuiltinThreadListDeps } from "./builtin-thread-list";

const List = () => null;
const URL_OF_LIST = "/api/v1/plugin-app-assets/abc/app.js";
const plugins = { plugins: [{ id: "other", app: { bundle: { jsUrl: "/other.js" } } }, { id: "thread-list", app: { bundle: { jsUrl: URL_OF_LIST } } }] };

type Registrar = (registration: { id: string; component?: unknown }) => void;
type App = { slots: { experimental_threadList: Registrar; experimental_threadAction: Registrar }; [key: string]: unknown };

const bundle = (setup: (app: App) => void) => ({ default: { __bbPluginApp: true, setup } });
const registersList = bundle((app) => {
  app.slots.experimental_threadAction({ id: "move" });
  app.slots.experimental_threadList({ id: "thread-list", component: List });
});

const loader = (deps: Partial<BuiltinThreadListDeps>) =>
  createBuiltinThreadListLoader({ fetchPlugins: async () => plugins, importBundle: async () => registersList, ...deps });

describe("загрузка встроенного списка тредов bb", () => {
  it("берёт адрес фронтенда плагина thread-list, подключает его и отдаёт компонент списка тредов", async () => {
    const importBundle = vi.fn(async () => registersList);
    expect(await loader({ importBundle })()).toBe(List);
    expect(importBundle).toHaveBeenCalledWith(URL_OF_LIST);
  });

  it("при подключении не падает на любом обращении плагина к приложению", async () => {
    const touchy = bundle((app) => {
      (app.settings as { define: (x: unknown) => void }).define({});
      (app.hooks as { onThing: () => void }).onThing();
      app.slots.experimental_threadList({ id: "thread-list", component: List });
    });
    expect(await loader({ importBundle: async () => touchy })()).toBe(List);
  });

  it("считает списком первый компонент слота, если id другой", async () => {
    const renamed = bundle((app) => app.slots.experimental_threadList({ id: "renamed", component: List }));
    expect(await loader({ importBundle: async () => renamed })()).toBe(List);
  });

  it.each([
    ["список плагинов не ответил", { fetchPlugins: async () => Promise.reject(new Error("offline")) }],
    ["плагина thread-list нет", { fetchPlugins: async () => ({ plugins: [] }) }],
    ["у плагина нет фронтенда", { fetchPlugins: async () => ({ plugins: [{ id: "thread-list" }] }) }],
    ["ответ не того вида", { fetchPlugins: async () => ({ nothing: true }) }],
    ["файл не подключился", { importBundle: async () => Promise.reject(new Error("404")) }],
    ["у файла другое устройство", { importBundle: async () => ({ default: {} }) }],
    ["setup упал", { importBundle: async () => bundle(() => { throw new Error("boom"); }) }],
    ["список тредов не зарегистрирован", { importBundle: async () => bundle((app) => app.slots.experimental_threadAction({ id: "move" })) }],
    ["регистрация без компонента", { importBundle: async () => bundle((app) => app.slots.experimental_threadList({ id: "thread-list" })) }],
  ] as const)("%s — вернётся null, ошибка наружу не выходит", async (_name, deps) => {
    expect(await loader(deps)()).toBeNull();
  });

  it("подключает один раз: повторные вызовы получают тот же результат", async () => {
    const importBundle = vi.fn(async () => registersList);
    const load = loader({ importBundle });
    expect(await Promise.all([load(), load()])).toEqual([List, List]);
    expect(await load()).toBe(List);
    expect(importBundle).toHaveBeenCalledTimes(1);
  });

  it("неудача не запоминается: следующий вызов подключает заново", async () => {
    const fetchPlugins = vi.fn().mockRejectedValueOnce(new Error("daemon starting")).mockResolvedValue(plugins);
    const load = loader({ fetchPlugins });
    expect(await load()).toBeNull();
    expect(await load()).toBe(List);
    expect(fetchPlugins).toHaveBeenCalledTimes(2);
  });
});

describe("useBuiltinThreadList", () => {
  it("пока список не нужен, ничего не загружает", () => {
    const load = vi.fn(async () => List);
    const { result } = renderHook(() => useBuiltinThreadList(false, load));
    expect(result.current).toEqual({ status: "loading" });
    expect(load).not.toHaveBeenCalled();
  });

  it("нужен: сперва loading, потом ready с компонентом", async () => {
    const { result } = renderHook(() => useBuiltinThreadList(true, async () => List));
    expect(result.current).toEqual({ status: "loading" });
    await waitFor(() => expect(result.current).toEqual({ status: "ready", Component: List }));
  });

  it("загрузчик вернул null — failed", async () => {
    const { result } = renderHook(() => useBuiltinThreadList(true, async () => null));
    await waitFor(() => expect(result.current).toEqual({ status: "failed" }));
  });

  it("список понадобился позже: загрузка стартует, когда needed становится true", async () => {
    const load = vi.fn(async () => List);
    const { result, rerender } = renderHook(({ needed }) => useBuiltinThreadList(needed, load), { initialProps: { needed: false } });
    expect(load).not.toHaveBeenCalled();
    rerender({ needed: true });
    await waitFor(() => expect(result.current).toEqual({ status: "ready", Component: List }));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("список перестал быть нужен до конца загрузки — результат не записывается", async () => {
    let resolve: (value: typeof List) => void = () => {};
    const load = () => new Promise<typeof List>((done) => (resolve = done));
    const { result, rerender } = renderHook(({ needed }) => useBuiltinThreadList(needed, load), { initialProps: { needed: true } });
    rerender({ needed: false });
    resolve(List);
    await Promise.resolve();
    await Promise.resolve();
    expect(result.current).toEqual({ status: "loading" });
  });
});
