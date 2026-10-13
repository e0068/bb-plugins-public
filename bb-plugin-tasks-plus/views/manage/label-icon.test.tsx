// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { prepareBoardDom } from "../../test-support/board-harness.js";

prepareBoardDom();
const app = await loadPluginApp(() => import("../../app"));

afterEach(cleanup);

const PROJECT_ID = "01HZZZZZZZZZZZZZZZZZZZZZP1";
const project = { id: PROJECT_ID, name: "Tasks", prefix: "TSK", nextTaskNumber: 1, color: "steelblue", folderId: null, linkedBbProjectId: null, tasksFolder: null, createdAt: "2026-07-15T00:00:00.000Z" };

async function renderLabels(updateLabel: (input: unknown) => unknown) {
  const slot = renderSlot(
    app.navPanels[0]!,
    { subPath: "manage" },
    {
      rpc: {
        listProjects: () => ({ projects: [project] }),
        listFolders: () => ({ folders: [] }),
        listPresets: () => ({ presets: [] }),
        listLabels: () => ({ labels: [{ id: "urgent", projectId: PROJECT_ID, name: "urgent", color: "#ef4444", icon: "🔥" }] }),
        sidebarSummary: () => ({ projects: [] }),
        listTasks: () => ({ tasks: [] }),
        listProjectRows: () => ({ projects: [], orphans: [] }),
        updateLabel,
      },
    },
  );
  fireEvent.mouseDown(await slot.findByRole("tab", { name: "Labels" }));
  return slot;
}

describe("a label's icon in Manage → Labels", () => {
  it("shows the icon the label has, and a pick writes the new one", async () => {
    const updateLabel = vi.fn(() => ({ label: {} }));
    const slot = await renderLabels(updateLabel);

    const button = await slot.findByRole("button", { name: "Icon of label urgent" });
    expect(button.querySelector("text")?.textContent).toBe("🔥");
    fireEvent.click(button);
    fireEvent.click(await slot.findByRole("button", { name: "Filled" }));
    fireEvent.change(await slot.findByLabelText("Search icons"), { target: { value: "flag-banner" } });
    fireEvent.click(await slot.findByRole("button", { name: "flag-banner" }));

    await waitFor(() => expect(updateLabel).toHaveBeenCalledWith({ labelId: "urgent", icon: "filled:ph:flag-banner" }));
  });
});
