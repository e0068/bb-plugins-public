// @vitest-environment jsdom
//
// bb's compact Home lays a fade over the rows passing under its composer and
// lifts it only when there is nothing to scroll. Scrolled to the foot of the
// queue, the last row stands right above the composer, so the section lifts
// the fade there and lets it back once the queue is scrolled up. jsdom lays
// nothing out: the scroller's sizes are set by hand, and what the fade gets is
// read off the section's arbitrary variants — see `utilitiesOn`.
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { compactHome045, utilitiesOn } from "./compact-home.testkit";

const SCROLL_HEIGHT = 1000;
const CLIENT_HEIGHT = 400;

/** The live section, moved into bb 0.45's compact Home, and a hand on its scroller. */
async function sectionOnCompactHome() {
  const app = await loadPluginApp(() => import("./app"));
  const slot = renderSlot(app.homepageSections[0]!, { projectId: null }, {
    sidebarThreads: { status: "ready", threads: [], projects: [] },
    rpc: { listPostponed: () => ({ postponed: [] }) },
  });
  const { scroller, slotBox, fade } = compactHome045();
  slotBox.append(slot.container);
  const root = slot.container.querySelector<HTMLElement>("[data-threads-overview-section]")!;
  Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: SCROLL_HEIGHT });
  Object.defineProperty(scroller, "clientHeight", { configurable: true, value: CLIENT_HEIGHT });
  const scrollTo = (top: number) =>
    act(() => {
      scroller.scrollTop = top;
      scroller.dispatchEvent(new Event("scroll"));
    });
  const fadeLifted = () => utilitiesOn(fade, root).includes("opacity-0");
  return { scrollTo, fadeLifted };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("the fade over bb's composer on the compact Home", () => {
  it("goes once the queue is scrolled to its foot", async () => {
    const { scrollTo, fadeLifted } = await sectionOnCompactHome();
    await scrollTo(SCROLL_HEIGHT - CLIENT_HEIGHT);
    expect(fadeLifted()).toBe(true);
  });

  it("stays while there is more of the queue below", async () => {
    const { scrollTo, fadeLifted } = await sectionOnCompactHome();
    await scrollTo(200);
    expect(fadeLifted()).toBe(false);
  });

  it("comes back once the queue is scrolled up from its foot", async () => {
    const { scrollTo, fadeLifted } = await sectionOnCompactHome();
    await scrollTo(SCROLL_HEIGHT - CLIENT_HEIGHT);
    await scrollTo(200);
    expect(fadeLifted()).toBe(false);
  });
});
