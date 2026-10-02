// @vitest-environment jsdom

import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));

afterEach(cleanup);

function renderReducedColorsSettings(stored: unknown) {
  const section = app.settingsSections.find((entry) => entry.id === "reduced-colors");
  return renderSlot(
    { component: section!.component },
    {},
    {
      rpc: {
        loadReducedColors: () => ({ enabled: true }),
        saveReducedColors: () => ({ ok: true }),
        loadReducedProjects: () => stored,
        saveReducedProjects: () => ({ ok: true }),
      },
    },
  );
}

describe("Reduced Colors settings — whether the projects are repainted too", () => {
  it("shows the projects repainted until the owner chooses otherwise", async () => {
    const slot = renderReducedColorsSettings("ramp");
    const box = await slot.findByRole("checkbox", { name: "Repaint projects too" });
    await waitFor(() => expect(box.getAttribute("aria-checked")).toBe("true"));
  });

  it("stores the projects' own colours once the box is cleared", async () => {
    const slot = renderReducedColorsSettings("ramp");
    const box = await slot.findByRole("checkbox", { name: "Repaint projects too" });
    await waitFor(() => expect(box.getAttribute("aria-checked")).toBe("true"));
    fireEvent.click(box);
    await waitFor(() => expect(box.getAttribute("aria-checked")).toBe("false"));
    const saves = slot.inspection.rpcCalls.filter(({ method }) => method === "saveReducedProjects");
    expect(saves.map(({ input }) => input)).toEqual([{ value: "own" }]);
  });

  it("shows a stored own-colours choice cleared", async () => {
    const slot = renderReducedColorsSettings("own");
    const box = await slot.findByRole("checkbox", { name: "Repaint projects too" });
    await waitFor(() => expect(box.getAttribute("aria-checked")).toBe("false"));
  });
});
