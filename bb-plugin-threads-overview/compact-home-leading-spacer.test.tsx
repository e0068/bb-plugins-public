// @vitest-environment jsdom
//
// The queue on bb 0.46.1's compact Home starts under the top bar. bb holds an
// empty spacer over the column of Recents and the plugin sections, about a
// third of the screen tall; left in place, it takes the top of the screen and
// the queue starts halfway down. The section hides it whichever way the queue
// runs, as it hid the spacer bb 0.45 kept there under another name.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { compactHome0461, utilitiesOn } from "./compact-home.testkit";

const PHONE_QUERY = "(max-width: 767px)";

/** A phone, as the media queries the section asks report it. */
function stubPhone(): void {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: query === PHONE_QUERY,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
}

/** The section's markup, copied into bb 0.46.1's compact Home. */
async function sectionOnCompactHome(invertOnPhone: boolean): Promise<{ leadingSpacer: HTMLElement; root: HTMLElement }> {
  stubPhone();
  const app = await loadPluginApp(() => import("./app"));
  const slot = renderSlot(app.homepageSections[0]!, { projectId: null }, {
    sidebarThreads: { status: "ready", threads: [], projects: [] },
    rpc: { listPostponed: () => ({ postponed: [] }) },
    settings: { invertOnPhone },
  });
  const rendered = slot.container.querySelector<HTMLElement>("[data-threads-overview-section]")!;
  const { slotBox, leadingSpacer } = compactHome0461();
  const root = rendered.cloneNode(true) as HTMLElement;
  slotBox.append(root);
  return { leadingSpacer, root };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("the queue on bb 0.46.1's compact Home", () => {
  it.each([
    ["top-down", false],
    ["bottom-up", true],
  ])("hides bb's leading spacer with the queue %s, so the queue starts under the top bar", async (_, invertOnPhone) => {
    const { leadingSpacer, root } = await sectionOnCompactHome(invertOnPhone);
    expect(utilitiesOn(leadingSpacer, root)).toContain("hidden");
  });
});
