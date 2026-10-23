// @vitest-environment jsdom
// Группа «Виджеты» в списке flow и страница виджета: из чего он состоит и как выглядит его карточка.
import type { ComponentType } from "react";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

import { anatomyOf, WIDGET_KINDS, widgetSkillFiles, widgetSubPath } from "../core/widget-anatomy";
import { BUILTIN_KINDS } from "../lib/stage-constants";
import type { FlowSettings } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const settings: FlowSettings = { version: 2, minButtonWidth: 170, flows: [{ id: "default", name: "Default", stages: [] }] };
const NAMES = ["Вопросы", "Definition of Done", "Выбор этапов", "Демонстрация", "Утверждение", "Правило"];

const open = (subPath: string, getWidgetFile: (input: { path: string }) => unknown = ({ path }) => ({ hostId: "host_1", path: `/plugin/${path}` })) =>
  renderSlot<PluginNavPanelProps, never>({ component: app.navPanels.find((p) => p.id === "flows")!.component as ComponentType<PluginNavPanelProps> }, { subPath }, {
    rpc: { getFlowSettings: () => settings, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => ({ skills: [], executors: [] }), getWidgetFile } as never,
    settings: { language: "Русский" },
  });

type Slot = ReturnType<typeof open>;
const nav = async (slot: Slot) => within(await slot.findByRole("navigation", { name: "Flow" }));

describe("группа «Виджеты» в списке flow", () => {
  it("под flow и над «Новый flow» — заголовок и шесть строк в порядке видов", async () => {
    const list = await nav(open("default"));
    expect(list.getAllByRole("button").map((b) => b.textContent).filter(Boolean)).toEqual(["Без flow", "Автоматически", "Default", ...NAMES, "Новый flow"]);
    expect(list.getByText("Виджеты")).toBeTruthy();
  });

  it("клик по строке пишет адрес виджета в панель", async () => {
    const slot = open("default");
    fireEvent.click((await nav(slot)).getByRole("button", { name: "Демонстрация" }));
    expect(slot.navigateCalls).toContainEqual({ method: "toPluginPanel", path: "flows", options: { subPath: widgetSubPath("demo") } });
  });

  it("на странице виджета подсвечена его строка и ни один flow", async () => {
    const list = await nav(open(widgetSubPath("select")));
    expect(list.getByRole("button", { name: "Выбор этапов" }).getAttribute("aria-current")).toBe("page");
    expect(list.getByRole("button", { name: "Default" }).getAttribute("aria-current")).toBeNull();
    expect(list.getByRole("button", { name: "Вопросы" }).getAttribute("aria-current")).toBeNull();
  });

  it("у строки виджета нет ручки перетаскивания", async () => {
    const list = await nav(open("default"));
    expect(list.queryAllByRole("button", { name: /^Перетащить flow/ }).map((b) => b.getAttribute("aria-label"))).toEqual(["Перетащить flow Default"]);
  });
});

describe("страница виджета", () => {
  it.each(WIDGET_KINDS.map((kind, i) => [kind, NAMES[i]!] as const))("вид %s: название, навык и файлы кода по ролям", async (kind, name) => {
    const slot = open(widgetSubPath(kind));
    expect(await slot.findByRole("heading", { name })).toBeTruthy();
    expect(slot.queryByRole("textbox", { name: "Название flow" })).toBeNull();
    for (const file of widgetSkillFiles(kind)) expect(slot.getByRole("button", { name: new RegExp(file.split("/").slice(-2).join("/")) })).toBeTruthy();
    for (const { files } of anatomyOf(kind)) for (const file of files) expect(slot.getAllByRole("button", { name: new RegExp(file.replace(/[.]/g, "\\.")) }).length).toBeGreaterThan(0);
  });

  it("клик по файлу спрашивает сервер и открывает его в просмотрщике bb", async () => {
    const slot = open(widgetSubPath("questions"));
    const row = (await slot.findAllByRole("button", { name: /shared\/contract\.ts/ }))[0]!;
    fireEvent.click(row);
    await waitFor(() => expect(slot.navigateCalls).toContainEqual({ method: "experimental_openFilePreview", options: { target: { kind: "host", hostId: "host_1", path: "/plugin/shared/contract.ts" }, location: null } }));
    expect(slot.rpcCalls).toContainEqual(expect.objectContaining({ method: "getWidgetFile", input: { path: "shared/contract.ts" } }));
  });

  it("сервер не нашёл файл — под составом строка об этом, просмотрщик не открывается", async () => {
    const slot = open(widgetSubPath("questions"), () => null);
    fireEvent.click((await slot.findAllByRole("button", { name: /shared\/contract\.ts/ }))[0]!);
    expect(await slot.findByText(/Файла нет в этой установке/)).toBeTruthy();
    expect(slot.navigateCalls.filter((c) => c.method === "experimental_openFilePreview")).toEqual([]);
  });

  it.each([
    ["questions", "Как показать файлы виджета на его странице?"],
    ["criteria", "В списке flow стоит группа виджетов из шести строк"],
    ["select", "Спецификация"],
    ["demo", "Страница показывает состав виджета"],
  ] as const)("под составом вида %s — настоящая карточка с учебным содержимым", async (kind, text) => {
    const slot = open(widgetSubPath(kind));
    expect(await slot.findByText(text, { exact: false })).toBeTruthy();
  });

  it.each(BUILTIN_KINDS)("у вида %s — его настройки: вид этапа и навык по умолчанию", async (kind) => {
    const slot = open(widgetSubPath(kind));
    expect(await slot.findByText("Вид этапа")).toBeTruthy();
    expect(slot.getByText(kind)).toBeTruthy();
  });

  it("у правила настроек этапа нет: оно не этап flow", async () => {
    const slot = open(widgetSubPath("rule"));
    expect(await slot.findByRole("heading", { name: "Правило" })).toBeTruthy();
    expect(slot.queryByText("Настройки вида")).toBeNull();
  });

  it("под составом правила — его карточка: «Записать» показывает исход и ничего не шлёт серверу", async () => {
    const slot = open(widgetSubPath("rule"));
    expect(((await slot.findByRole("textbox", { name: "Текст правила" })) as HTMLTextAreaElement).value).toBe("Подписи развилок — словами владельца, а не именами полей");
    expect(slot.getByText("заменить")).toBeTruthy();
    expect(slot.getByText("расходится — правило заменит эту строку")).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Записать" }));
    await waitFor(() => expect(slot.getByRole("status").textContent).toContain("Записано"));
    expect(slot.rpcCalls.filter((c) => c.method === "decideRule")).toEqual([]);
  });

  it("под составом Утверждения — карточка из поля комментария и кнопки «Продолжить»", async () => {
    const slot = open(widgetSubPath("approve"));
    expect(await slot.findByRole("button", { name: "Продолжить" })).toBeTruthy();
  });
});
