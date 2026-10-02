// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { Label } from "../../shared/contract.js";
import type { BoardGroupProperty } from "../../shared/enums.js";

await loadPluginApp(() => import("../../app"));
const { GroupIcon } = await import("./group-icon.js");
const { NONE_KEY } = await import("./grouping.js");

afterEach(cleanup);

const labels: Label[] = [{ id: "L1", projectId: "P1", name: "tasks-plus", color: "#00aa00" } as Label];

const icon = (groupBy: BoardGroupProperty, groupKey: string) =>
  renderSlot({ component: () => <GroupIcon groupBy={groupBy} groupKey={groupKey} labels={labels} /> }, {}, {}).container;

describe("a group's icon shows the value the group stands for", () => {
  it("a status group carries its status ring", () => {
    expect(icon("status", "in_progress").querySelector('[data-status-icon="in_progress"]')).not.toBeNull();
  });

  it("a priority group carries its priority bars", () => {
    expect(icon("priority", "high").querySelector('[data-priority-icon="high"]')).not.toBeNull();
  });

  it("a type group and an estimate group carry an icon", () => {
    expect(icon("type", "feature").querySelector("svg")).not.toBeNull();
    cleanup();
    expect(icon("estimate", "m").querySelector("svg")).not.toBeNull();
  });

  it("a type group and an estimate group for no value carry none", () => {
    expect(icon("type", NONE_KEY).firstElementChild).toBeNull();
    cleanup();
    expect(icon("estimate", NONE_KEY).firstElementChild).toBeNull();
  });

  it("a label group carries a dot of the label's color", () => {
    const dot = icon("label", "tasks-plus").querySelector("[aria-hidden]") as HTMLElement;
    expect(dot.style.backgroundColor).toBe("rgb(0, 170, 0)");
  });

  it("an assignee group carries no icon", () => {
    expect(icon("assignee", "Vakhnin Sergei").firstElementChild).toBeNull();
  });
});
