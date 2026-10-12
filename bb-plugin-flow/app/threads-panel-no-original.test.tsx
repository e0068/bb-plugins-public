// @vitest-environment jsdom
// Хост bb 0.46.0 вызывает слот списка тредов без `Original`; прежние тесты передавали его сами (тип в SDK объявляет его
// обязательным), поэтому здесь он не передаётся. Вне страницы Flow слот рисует встроенный список bb — с проектами и
// закреплениями, как «Thread list (built-in)», — а если тот не подключился или упал, запасной простой список; на странице
// Flow с включённой настройкой — список flow.
import { cleanup, within } from "@testing-library/react";
import type { PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { flowRoute } from "../lib/panel-path";
import { builtinStage } from "../lib/stage-constants";
import type { FlowSettings } from "../shared/contract";
import type { BuiltinListState } from "./builtin-thread-list";

let builtin: BuiltinListState = { status: "loading" };
const needed = vi.fn();
vi.mock("./builtin-thread-list", () => ({
  useBuiltinThreadList: (isNeeded: boolean) => (needed(isNeeded), builtin),
}));

window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList);

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);
beforeEach(() => {
  builtin = { status: "loading" };
  needed.mockClear();
});

const BuiltinList = (props: Partial<PluginThreadListProps>) => <div data-testid="builtin-threads">встроенный список bb · {String(props.activeThreadId)}</div>;
const Broken = () => {
  throw new Error("builtin list exploded");
};
const HostOriginal = () => <div data-testid="host-original">Original от хоста</div>;
const settings: FlowSettings = { version: 2, minButtonWidth: 170, flows: [{ id: "default", name: "Default", stages: [builtinStage("criteria", [])] }] };

const open = (options: { on?: boolean; path?: string; original?: boolean }) => {
  window.history.pushState({}, "", options.path ?? "/threads/thr_1");
  const props = { activeThreadId: "thr_1", activeProjectId: null, isCompactViewport: false, onNavigate: vi.fn(), searchQuery: "" };
  return renderSlot<PluginThreadListProps, never>(app.threadLists[0]!, (options.original === true ? { ...props, Original: HostOriginal } : props) as never, {
    rpc: { getFlowSettings: () => settings, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => ({ skills: [], executors: [] }) } as never,
    sidebarThreads: { status: "ready", threads: [{ id: "t1", projectId: "p", title: "Мой тред", titleFallback: null, parentThreadId: null, isArchived: false, updatedAt: 1 } as never] },
    settings: { language: "Русский", ...(options.on === false ? {} : { showFlowsInThreadsPanel: true }) },
  });
};

describe("слот Flow на хосте без Original", () => {
  it("вне страницы Flow рисует встроенный список bb со свойствами слота и не падает", () => {
    builtin = { status: "ready", Component: BuiltinList };
    const slot = open({});
    expect(slot.getByTestId("builtin-threads").textContent).toContain("thr_1");
    expect(slot.queryByRole("navigation", { name: "Flow" })).toBeNull();
  });

  it("на странице Flow при выключенной настройке тоже встроенный список", () => {
    builtin = { status: "ready", Component: BuiltinList };
    expect(open({ path: flowRoute("default"), on: false }).getByTestId("builtin-threads")).toBeTruthy();
  });

  it("на странице Flow с включённой настройкой — список flow вместо тредов", async () => {
    builtin = { status: "ready", Component: BuiltinList };
    const slot = open({ path: flowRoute("default") });
    const nav = within(await slot.findByRole("navigation", { name: "Flow" }));
    expect(nav.getByRole("button", { name: "Default" })).toBeTruthy();
    expect(slot.queryByTestId("builtin-threads")).toBeNull();
  });

  it("встроенный список загружается только когда он нужен: на странице Flow с настройкой и при Original — нет", () => {
    open({ path: flowRoute("default") });
    expect(needed).toHaveBeenLastCalledWith(false);
    cleanup();
    open({ original: true });
    expect(needed).toHaveBeenLastCalledWith(false);
    cleanup();
    open({});
    expect(needed).toHaveBeenLastCalledWith(true);
  });

  it("встроенный список ещё подключается — слот пуст и не падает", () => {
    expect(open({}).container.textContent).toBe("");
  });

  it("встроенный список не подключился — запасной список с тредами", () => {
    builtin = { status: "failed" };
    expect(open({}).getByRole("button", { name: "Мой тред" })).toBeTruthy();
  });

  it("встроенный список упал при отрисовке — запасной список, а не плашка «stopped working»", () => {
    builtin = { status: "ready", Component: Broken };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const slot = open({});
    expect(slot.getByRole("button", { name: "Мой тред" })).toBeTruthy();
    error.mockRestore();
  });

  it("если хост всё же отдал Original — берёт его", () => {
    builtin = { status: "ready", Component: BuiltinList };
    const slot = open({ original: true });
    expect(slot.getByTestId("host-original")).toBeTruthy();
    expect(slot.queryByTestId("builtin-threads")).toBeNull();
  });
});
