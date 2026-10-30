// @vitest-environment jsdom
import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThreadsState } from "@get-bb/plugin-sdk/app";
import { prepareBoardDom } from "../test-support/board-harness.js";

prepareBoardDom();
const app = await loadPluginApp(() => import("../app"));

afterEach(() => {
  cleanup();
  document.querySelectorAll("[data-test-sidebar]").forEach((node) => node.remove());
});

const board = (patch: Record<string, unknown> = {}) => ({
  id: "01HZZZZZZZZZZZZZZZZZZZZZP1",
  name: "Shapeshift",
  prefix: "SHA",
  nextTaskNumber: 1,
  color: "steelblue",
  folderId: null,
  linkedBbProjectId: "proj_shape",
  tasksFolder: null,
  createdAt: "2026-07-15T00:00:00.000Z",
  ...patch,
});

/** A child thread's row of bb's thread list as bb 0.48 draws it under its parent's project: when the thread works
 *  in another project, bb puts its folder-with-an-arrow after the title. */
function bbChildRow(projectId: string, crossProject: boolean): HTMLElement {
  const row = document.createElement("div");
  row.setAttribute("data-test-sidebar", "");
  row.setAttribute("data-sidebar-rename-row", "");
  row.innerHTML = `
    <span class="relative flex min-w-0 flex-1 items-center gap-1.5 self-stretch">
      <a href="/projects/${projectId}/threads/thr_child" data-sidebar-thread-id="thr_child" class="absolute inset-0"></a>
      <span class="contents">
        <span class="pointer-events-none relative flex min-w-0 items-center self-stretch">
          <span class="bb-thread-title min-w-0 truncate" title="Child"><span class="truncate">Child</span></span>
        </span>
        ${
          crossProject
            ? `<span data-sidebar-thread-cross-project="" role="img" aria-label="In project Shapeshift" class="flex size-5 items-center justify-center">
                 <svg viewBox="0 0 24 24" class="size-3.5" aria-hidden="true" data-icon="FolderExport" data-icon-root=""><path d="M0 0"></path></svg>
               </span>`
            : ""
        }
      </span>
    </span>`;
  document.body.append(row);
  return row;
}

function renderOverlay(projects: unknown[]) {
  const overlay = app.appOverlays.find((entry) => entry.id === "sidebar-project-icons");
  const sidebarThreads: Partial<PluginSidebarThreadsState> = {
    status: "ready",
    threads: [],
    projects: [{ id: "proj_plugins", name: "bb-plugins" }, { id: "proj_shape", name: "Shapeshift" }, { id: "proj_notes", name: "Notes" }] as never,
  };
  return renderSlot({ component: overlay!.component }, {}, { rpc: { listProjects: () => ({ projects }) }, sidebarThreads });
}

const marker = (row: HTMLElement) => row.querySelector("[data-sidebar-thread-cross-project]")!;
const bbFolder = (row: HTMLElement) => marker(row).querySelector<SVGElement>('[data-icon="FolderExport"]')!;
const projectIcon = (row: HTMLElement) => marker(row).querySelector("[data-tasks-thread-project-icon]");

describe("a child thread working in another project, in bb's thread list", () => {
  it("wears the icon of the project it works in instead of bb's folder", async () => {
    const row = bbChildRow("proj_shape", true);
    renderOverlay([board({ icon: "🚀" })]);

    await waitFor(() => expect(projectIcon(row)).not.toBeNull());
    expect(projectIcon(row)!.querySelector("text")?.textContent).toBe("🚀");
    expect(bbFolder(row).style.display).toBe("none");
    // bb's own hint over the marker — «In project Shapeshift» — stays.
    expect(marker(row).getAttribute("aria-label")).toBe("In project Shapeshift");
  });

  it("wears the project's colour, so a board without an icon shows its coloured folder", async () => {
    const row = bbChildRow("proj_shape", true);
    renderOverlay([board()]);

    await waitFor(() => expect(projectIcon(row)?.querySelector("path") ?? null).not.toBeNull());
    expect(bbFolder(row).style.display).toBe("none");
  });

  it("keeps bb's folder when no board is linked to the project it works in", async () => {
    const plain = bbChildRow("proj_notes", true);
    const linked = bbChildRow("proj_shape", true);
    renderOverlay([board({ icon: "🚀" })]);

    await waitFor(() => expect(projectIcon(linked)).not.toBeNull());
    expect(projectIcon(plain)).toBeNull();
    expect(bbFolder(plain).style.display).toBe("");
  });

  it("leaves a thread of its own project as bb draws it", async () => {
    const own = bbChildRow("proj_shape", false);
    const other = bbChildRow("proj_shape", true);
    renderOverlay([board({ icon: "🚀" })]);

    await waitFor(() => expect(projectIcon(other)).not.toBeNull());
    expect(own.querySelector("[data-tasks-thread-project-icon]")).toBeNull();
  });

  it("gives bb's folder back when the overlay goes", async () => {
    const row = bbChildRow("proj_shape", true);
    const slot = renderOverlay([board({ icon: "🚀" })]);
    await waitFor(() => expect(projectIcon(row)).not.toBeNull());

    slot.unmount();

    expect(projectIcon(row)).toBeNull();
    expect(bbFolder(row).style.display).toBe("");
  });
});
