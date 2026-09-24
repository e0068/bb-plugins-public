// @vitest-environment jsdom
// Лента flow и создание живут в шапке панели — хост монтирует её отдельно от
// страницы, поэтому выбранный flow они делят только адресом панели.
import type { ComponentType } from "react";
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import { builtinStage, stageKindOf } from "../lib/stage-constants";
import type { FlowSettings, flowSettingsRpcContract, StageCatalog } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const flow = (id: string, name: string) => ({ id, name, stages: [builtinStage("criteria", []), { id: "implement", kind: "skill" as const, skill: "code", name: "Код", executors: [] }] });

const settings: FlowSettings = { version: 2, flows: [flow("default", "Default"), flow("quick", "Quick")], minButtonWidth: 170 };

const catalog: StageCatalog = { skills: [{ name: "plan" }], executors: [] };

const panel = () => app.navPanels.find((p) => p.id === "flows")!;

const mount = (component: ComponentType<PluginNavPanelProps>, subPath: string) =>
  renderSlot<PluginNavPanelProps, typeof flowSettingsRpcContract>({ component }, { subPath }, {
    rpc: { getFlowSettings: () => settings, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => catalog } as never,
    settings: { language: "Русский" },
  });

const openHeader = (subPath = "") => mount(panel().headerContent!, subPath);
const openPage = (subPath = "") => mount(panel().component, subPath);

type Slot = ReturnType<typeof openHeader>;
const lastSaved = (slot: Slot): FlowSettings | undefined => [...slot.rpcCalls].reverse().find((c) => c.method === "saveFlowSettings")?.input as FlowSettings | undefined;
const strip = (slot: Slot) => slot.findByRole("navigation", { name: "Flow" });

describe("шапка панели Flow", () => {
  it("панель отдаёт хосту шапку рядом со страницей", () => {
    expect(typeof panel().headerContent).toBe("function");
  });

  it("в шапке — лента flow, выбранный помечен текущим", async () => {
    const tabs = within(await strip(openHeader("quick")));
    expect(tabs.getByRole("button", { name: "Quick" }).getAttribute("aria-current")).toBe("page");
    expect(tabs.getByRole("button", { name: "Default" }).getAttribute("aria-current")).toBeNull();
  });

  it("выбор flow — адрес панели, а не свой стейт: страница читает его тем же subPath", async () => {
    const slot = openHeader();
    fireEvent.click(within(await strip(slot)).getByRole("button", { name: "Quick" }));
    expect(slot.navigateCalls).toContainEqual({ method: "toPluginPanel", path: "flows", options: { subPath: "quick" } });
  });

  it("создание flow — кнопка с иконкой Плюса; новый flow сразу открыт", async () => {
    const slot = openHeader();
    const add = within(await strip(slot)).getByRole("button", { name: "Новый flow" });
    expect(add.textContent).toBe("");
    fireEvent.click(add);
    await vi.waitFor(() => expect(lastSaved(slot)?.flows).toHaveLength(3));
    const created = lastSaved(slot)!.flows[2]!.id;
    expect(slot.navigateCalls).toContainEqual({ method: "toPluginPanel", path: "flows", options: { subPath: created } });
  });

  it("новый flow получает этапы по умолчанию с Вопросами, Критериями и Выбором этапов впереди", async () => {
    const slot = openHeader();
    fireEvent.click(within(await strip(slot)).getByRole("button", { name: "Новый flow" }));
    await vi.waitFor(() => expect(lastSaved(slot)?.flows).toHaveLength(3));
    expect(lastSaved(slot)!.flows[2]!.stages.slice(0, 3).map(stageKindOf)).toEqual(["questions", "criteria", "select"]);
  });

  it("удаления flow в ленте нет — оно внизу страницы", async () => {
    expect(within(await strip(openHeader())).queryByRole("button", { name: /Удалить flow/ })).toBeNull();
  });

  it("лента листается вбок сама, а не вместе с заголовком", async () => {
    const nav = await strip(openHeader());
    expect(nav.className).toContain("overflow-x-auto");
  });
});

describe("шапка и страница под одним хранилищем", () => {
  // Хост монтирует их порознь, поэтому в тесте они соседи в одном дереве:
  // хранилище коллекции одно на обе ветви, и коллекция читается с сервера раз.
  const Panel = ({ subPath }: PluginNavPanelProps) => {
    const Header = panel().headerContent!;
    const Page = panel().component;
    return (
      <>
        <Header subPath={subPath} />
        <Page subPath={subPath} />
      </>
    );
  };

  it("коллекция читается с сервера один раз на обе ветви", async () => {
    const slot = mount(Panel, "");
    await strip(slot);
    await slot.findByRole("textbox", { name: "Название flow" });
    expect(slot.rpcCalls.filter((c) => c.method === "getFlowSettings")).toHaveLength(1);
  });

  it("созданный в шапке flow страница берёт из той же коллекции, не перечитывая сервер", async () => {
    const slot = mount(Panel, "");
    fireEvent.click(within(await strip(slot)).getByRole("button", { name: "Новый flow" }));
    await vi.waitFor(() => expect(lastSaved(slot)?.flows).toHaveLength(3));
    const created = lastSaved(slot)!.flows[2]!.id;
    slot.lifecycle.rerender(<Panel subPath={created} />);
    const name = (await slot.findByRole("textbox", { name: "Название flow" })) as HTMLInputElement;
    expect(name.value).toBe("Новый flow");
    expect(slot.rpcCalls.filter((c) => c.method === "getFlowSettings")).toHaveLength(1);
  });
});

describe("тело страницы Flow", () => {
  it("ленты выбора в теле нет — содержимое начинается с имени выбранного flow", async () => {
    const slot = openPage("quick");
    const name = (await slot.findByRole("textbox", { name: "Название flow" })) as HTMLInputElement;
    expect(name.value).toBe("Quick");
    expect(slot.queryByRole("navigation", { name: "Flow" })).toBeNull();
    expect(slot.queryByRole("button", { name: "Новый flow" })).toBeNull();
  });
});
