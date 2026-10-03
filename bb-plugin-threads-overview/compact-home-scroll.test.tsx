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

const SCROLLER = "root-compose-compact-scroll-viewport";

/**
 * bb 0.45's compact Home around a plugin section: the scroller, the box bb
 * holds at the scroller's height and pushes its content to the foot of, the
 * column with Recents and the plugin sections, and the spacer under the composer.
 */
function compactHome045(): { scroller: HTMLElement; slotBox: HTMLElement } {
  const home = document.createElement("div");
  home.dataset.testid = "root-compose-compact-home";
  home.innerHTML = `
    <div data-testid="${SCROLLER}" class="absolute inset-x-0 bottom-0 overflow-y-auto overscroll-contain">
      <div data-testid="root-compose-compact-scroll-content" class="flex min-h-full flex-col justify-end">
        <div data-testid="root-compose-compact-recents-offset"></div>
        <div class="mx-auto w-full max-w-[760px] px-4">
          <section class="md:hidden" data-root-compose-mobile-recents=""></section>
          <div class="mt-6 space-y-6" data-testid="plugin-homepage-sections">
            <section class="space-y-3"><div class="contents" data-slot-box=""></div></section>
          </div>
        </div>
        <div data-testid="root-compose-compact-bottom-spacer"></div>
      </div>
    </div>`;
  document.body.append(home);
  return {
    scroller: home.querySelector<HTMLElement>(`[data-testid=${SCROLLER}]`)!,
    slotBox: home.querySelector<HTMLElement>("[data-slot-box]")!,
  };
}

/** Every utility the section's arbitrary variants put on `box`, read off the classes under `root`. */
function utilitiesOn(box: Element, root: HTMLElement): string[] {
  const utilities: string[] = [];
  const owners = [root, ...Array.from(root.querySelectorAll<HTMLElement>("[class]"))];
  owners.forEach((owner, index) => {
    owner.setAttribute("data-variant-owner", String(index));
    for (const token of owner.classList) {
      const variant = /^\[(.+)\]:(.+)$/.exec(token);
      if (variant === null) continue;
      const selector = variant[1]!.replaceAll("_", " ").replaceAll("&", `[data-variant-owner="${index}"]`);
      if (Array.from(document.querySelectorAll(selector)).includes(box)) utilities.push(variant[2]!);
    }
  });
  return utilities;
}

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
