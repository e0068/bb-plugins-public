// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { prepareBoardDom } from "../../test-support/board-harness.js";

prepareBoardDom();
const app = await loadPluginApp(() => import("../../app"));

afterEach(cleanup);

function renderManage() {
  return renderSlot(
    app.navPanels[0]!,
    { subPath: "manage" },
    {
      rpc: {
        listProjects: () => ({ projects: [] }),
        listFolders: () => ({ folders: [] }),
        listPresets: () => ({ presets: [] }),
        listLabels: () => ({ labels: [] }),
        sidebarSummary: () => ({ projects: [] }),
        listTasks: () => ({ tasks: [] }),
        listProjectRows: () => ({ projects: [{ bbProject: { id: "proj_corpus", name: "Corpus", repoPath: "/repos/corpus" }, board: null }], orphans: [] }),
      },
    },
  );
}

describe("Manage's tabs", () => {
  it("are Projects, Labels and Presets — no Project, no Folders", async () => {
    const slot = renderManage();
    await slot.findByRole("tab", { name: "Projects" });
    expect(slot.getAllByRole("tab").map((tab) => tab.textContent?.trim())).toEqual(["Projects", "Labels", "Presets"]);
  });

  it("open on Projects, the table of bb projects", async () => {
    const slot = renderManage();
    const tab = await slot.findByRole("tab", { name: "Projects" });
    expect(tab.getAttribute("aria-selected")).toBe("true");
    expect(await slot.findByRole("table", { name: "bb projects" })).toBeTruthy();
  });
});
