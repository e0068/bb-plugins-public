// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { onProjectsChanged } from "@bb-plugins/task-bridge";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThreadsState } from "@get-bb/plugin-sdk/app";
import { prepareBoardDom } from "../test-support/board-harness.js";

prepareBoardDom();
const app = await loadPluginApp(() => import("../app"));

afterEach(() => {
  cleanup();
  document.querySelectorAll("[data-test-sidebar]").forEach((node) => node.remove());
});

const BOARD_ID = "01HZZZZZZZZZZZZZZZZZZZZZP1";
const board = (icon: string) => ({ id: BOARD_ID, name: "Plugins", prefix: "BBPL", nextTaskNumber: 1, color: "steelblue", folderId: null, linkedBbProjectId: "proj_a1", tasksFolder: null, createdAt: "2026-07-15T00:00:00.000Z", icon });

function bbRow(): HTMLElement {
  const group = document.createElement("div");
  group.setAttribute("data-test-sidebar", "");
  group.setAttribute("data-sidebar-sticky-group", "");
  group.innerHTML = `
    <div role="button" data-sidebar="group-label">
      <span class="relative z-10 flex min-w-0 flex-1 items-center gap-1 text-left">
        <span class="min-w-0 truncate" title="bb-plugins">bb-plugins</span>
      </span>
      <span data-sidebar-row-controls=""><button type="button" class="h-7 w-7 rounded-md" aria-label="bb-plugins actions"></button></span>
    </div>`;
  document.body.append(group);
  return group;
}

function renderOverlay(icon: string) {
  const overlay = app.appOverlays.find((entry) => entry.id === "sidebar-project-icons")!;
  const sidebarThreads: Partial<PluginSidebarThreadsState> = { status: "ready", threads: [], projects: [{ id: "proj_a1", name: "bb-plugins" }] as never };
  return renderSlot({ component: overlay.component }, {}, { rpc: { listProjects: () => ({ projects: [board(icon)] }), updateProject: (input: unknown) => ({ project: input }) }, sidebarThreads });
}

const rowButton = (group: HTMLElement) => group.querySelector<HTMLButtonElement>("[data-tasks-project-icon]");

describe("a project's icon in bb's thread list, in its own colours", () => {
  it("is a button the size of bb's buttons on the row, its icon as big as theirs", async () => {
    const group = bbRow();
    renderOverlay("ph:rocket");
    await waitFor(() => expect(rowButton(group)).not.toBeNull());

    const classes = rowButton(group)!.className.split(" ");
    const icon = rowButton(group)!.querySelector("svg")!.getAttribute("class")!.split(" ");
    expect(classes).toEqual(expect.arrayContaining(["h-7", "w-7", "rounded-md", "hover:bg-state-hover", "max-md:pointer-coarse:h-9", "max-md:pointer-coarse:w-9"]));
    expect(icon).toEqual(expect.arrayContaining(["size-4", "max-md:pointer-coarse:size-5"]));
  });

  it("keeps its icon where the icon was, by giving the button's extra size back in negative margins", async () => {
    const group = bbRow();
    renderOverlay("ph:rocket");
    await waitFor(() => expect(rowButton(group)).not.toBeNull());

    expect(rowButton(group)!.className.split(" ")).toEqual(
      expect.arrayContaining(["-my-1.5", "-ml-1.5", "-mr-1", "max-md:pointer-coarse:-my-2", "max-md:pointer-coarse:-ml-2", "max-md:pointer-coarse:-mr-1.5"]),
    );
  });

  it("draws a Phosphor sign on its own tile", async () => {
    const group = bbRow();
    renderOverlay("filled:ph:rocket;c=black;bg=goldenrod");
    await waitFor(() => {
      const svg = rowButton(group)?.querySelector("svg");
      expect(svg?.querySelector("rect")?.getAttribute("fill")).toBe("goldenrod");
      expect(svg?.querySelector("g")?.getAttribute("color")).toBe("black");
    });
  });

  it("writes a colour picked for the chosen icon at once and keeps the picker open", async () => {
    const group = bbRow();
    const slot = renderOverlay("ph:rocket");
    await waitFor(() => expect(rowButton(group)).not.toBeNull());

    fireEvent.click(rowButton(group)!);
    fireEvent.click(await slot.findByRole("radio", { name: "Red line" }));

    await waitFor(() =>
      expect(slot.inspection.rpcCalls.filter(({ method }) => method === "updateProject").map(({ input }) => input)).toEqual([{ projectId: BOARD_ID, icon: "ph:rocket;c=indianred" }]),
    );
    expect(slot.queryByLabelText("Search icons")).not.toBeNull();
  });
});

describe("a colour picked from the thread list while the picker is open", () => {
  it("redraws the row's own button in place, so the picker keeps hanging from it", async () => {
    const group = bbRow();
    let icon = "ph:rocket";
    const overlay = app.appOverlays.find((entry) => entry.id === "sidebar-project-icons")!;
    const sidebarThreads: Partial<PluginSidebarThreadsState> = { status: "ready", threads: [], projects: [{ id: "proj_a1", name: "bb-plugins" }] as never };
    const slot = renderSlot({ component: overlay.component }, {}, {
      rpc: {
        listProjects: () => ({ projects: [board(icon)] }),
        updateProject: (input: unknown) => {
          icon = (input as { icon: string }).icon;
          return { project: board(icon) };
        },
      },
      sidebarThreads,
    });
    await waitFor(() => expect(rowButton(group)).not.toBeNull());
    const button = rowButton(group)!;

    fireEvent.click(button);
    fireEvent.click(await slot.findByRole("radio", { name: "Red line" }));
    await waitFor(() => expect(icon).toBe("ph:rocket;c=indianred"));
    // The server tells every view the board changed, as it does after updateProject.
    await slot.behavior.emitRealtime("projects:changed", { projectId: BOARD_ID });

    await waitFor(() => expect(button.getAttribute("data-tasks-project-icon-key")).toBe("ph:rocket;c=indianred|steelblue"));
    expect(button.isConnected).toBe(true);
    expect(rowButton(group)).toBe(button);
    expect(slot.queryByLabelText("Search icons")).not.toBeNull();
  });
});

describe("a board change told to other plugins", () => {
  it("reaches the window, where Threads Overview hears it to redraw its project icons", async () => {
    const changed = vi.fn();
    const off = onProjectsChanged(window, changed);
    const slot = renderOverlay("ph:rocket");
    await slot.behavior.emitRealtime("projects:changed", { projectId: BOARD_ID });
    off();
    expect(changed).toHaveBeenCalledTimes(1);
  });
});
