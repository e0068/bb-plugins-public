// @vitest-environment jsdom
//
// The queue on bb's compact Home scrolls. The section stretches bb's own boxes
// between the page scroller and itself with classes whose arbitrary variants
// name those boxes — `[<host selector with &>]:<utility>` — so what a host box
// gets is read here by running each variant's selector against bb's Home. jsdom
// lays nothing out, so the promise is pinned on the flex sizing the boxes end up
// with. A flex box bb gives a minimum height of its own (`min-h-full`, the
// scroller's) loses the floor of its content: sized from a zero basis, or let
// shrink, it stays as tall as the scroller however long the list, and the list
// spills over its top, where nothing scrolls.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { compactHome045, utilitiesOn } from "./compact-home.testkit";

/** The section's markup, copied into bb 0.45's compact Home. */
async function sectionOnCompactHome(): Promise<{ scroller: HTMLElement; root: HTMLElement }> {
  const app = await loadPluginApp(() => import("./app"));
  const slot = renderSlot(app.homepageSections[0]!, { projectId: null }, {
    sidebarThreads: { status: "ready", threads: [], projects: [] },
    rpc: { listPostponed: () => ({ postponed: [] }) },
  });
  const rendered = slot.container.querySelector<HTMLElement>("[data-threads-overview-section]")!;
  const { scroller, slotBox } = compactHome045();
  const root = rendered.cloneNode(true) as HTMLElement;
  slotBox.append(root);
  return { scroller, root };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("the queue on bb 0.45's compact Home", () => {
  it("sizes the box bb holds at the scroller's height by the list, so the scroller has the list to scroll", async () => {
    const { scroller, root } = await sectionOnCompactHome();
    const held = Array.from(scroller.querySelectorAll(".min-h-full")).filter((box) => box.contains(root));
    expect(held.length).toBeGreaterThan(0);
    for (const box of held) {
      const utilities = utilitiesOn(box, root);
      expect(utilities.filter((utility) => utility === "flex-1" || utility === "basis-0")).toEqual([]);
      expect(utilities).toContain("shrink-0");
    }
  });

  it("still lets the section fill the scroller from under the top bar", async () => {
    const { scroller, root } = await sectionOnCompactHome();
    expect(utilitiesOn(scroller, root)).toEqual(expect.arrayContaining(["top-14!", "flex", "flex-col"]));
  });

  it("stretches the column with the sections down the scroller, so a short list starts under the top bar", async () => {
    const { scroller, root } = await sectionOnCompactHome();
    const column = scroller.querySelector("[data-testid=plugin-homepage-sections]")!.parentElement!;
    expect(utilitiesOn(column, root)).toEqual(expect.arrayContaining(["flex", "grow", "flex-col"]));
  });
});
