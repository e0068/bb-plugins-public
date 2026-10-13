// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
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

const BOARD_ID = "01HZZZZZZZZZZZZZZZZZZZZZP1";
const board = (patch: Record<string, unknown> = {}) => ({
  id: BOARD_ID,
  name: "Plugins",
  prefix: "BBPL",
  nextTaskNumber: 1,
  color: "steelblue",
  folderId: null,
  linkedBbProjectId: "proj_a1",
  tasksFolder: null,
  createdAt: "2026-07-15T00:00:00.000Z",
  ...patch,
});

/** A project row of bb's thread list as bb 0.46 draws it: the label with its name, then its threads. */
function bbRow(name: string, threads: readonly string[]): HTMLElement {
  const group = document.createElement("div");
  group.setAttribute("data-test-sidebar", "");
  group.setAttribute("data-sidebar-sticky-group", "");
  group.innerHTML = `
    <div role="button" data-sidebar="group-label">
      <span class="relative z-10 flex min-w-0 flex-1 items-center gap-1 text-left">
        <span class="min-w-0 truncate" title="${name}">${name}</span>
        <button type="button" aria-label="Collapse ${name} section"></button>
      </span>
      <span data-sidebar-trailing-controls="">
        <span data-sidebar-row-controls="">
          <button type="button" class="h-7 w-7 rounded-md" aria-label="New thread in ${name}"></button>
          <button type="button" class="h-7 w-7 rounded-md" aria-label="${name} actions" aria-haspopup="menu"></button>
        </span>
      </span>
    </div>
    ${threads.map((id) => `<div><a href="/projects/${id.split(":")[0]}/threads/${id.split(":")[1]}" data-sidebar-thread-id="${id.split(":")[1]}"></a></div>`).join("")}`;
  document.body.append(group);
  return group;
}

function renderOverlay(projects: unknown[], updateProject: (input: unknown) => unknown = (input) => ({ project: input })) {
  const overlay = app.appOverlays.find((entry) => entry.id === "sidebar-project-icons");
  const sidebarThreads: Partial<PluginSidebarThreadsState> = {
    status: "ready",
    threads: [],
    projects: [{ id: "proj_a1", name: "bb-plugins" }, { id: "proj_b2", name: "Notes" }] as never,
  };
  return renderSlot({ component: overlay!.component }, {}, { rpc: { listProjects: () => ({ projects }), updateProject }, sidebarThreads });
}

const rowButton = (group: HTMLElement) => group.querySelector<HTMLButtonElement>("[data-tasks-project-icon]");

describe("a project's icon in bb's thread list", () => {
  it("stands before the name of a project with a board, as the board's icon", async () => {
    const group = bbRow("bb-plugins", ["proj_a1:thr_1"]);
    renderOverlay([board({ icon: "🚀" })]);

    await waitFor(() => expect(rowButton(group)).not.toBeNull());
    const button = rowButton(group)!;
    expect(button.nextElementSibling?.textContent).toBe("bb-plugins");
    expect(button.getAttribute("aria-label")).toBe("Icon of bb-plugins");
    expect(button.querySelector("text")?.textContent).toBe("🚀");
    // Without its box the 24-unit drawing is cut to the 16px corner it is shown in.
    expect(button.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 24 24");
  });

  it("is the folder for a board that chose none", async () => {
    const group = bbRow("bb-plugins", []);
    renderOverlay([board()]);

    await waitFor(() => expect(rowButton(group)?.querySelector("svg path")).not.toBeNull());
  });

  it("is not there for a project no board is linked to", async () => {
    const plain = bbRow("Notes", []);
    const linked = bbRow("bb-plugins", []);
    renderOverlay([board()]);

    await waitFor(() => expect(rowButton(linked)).not.toBeNull());
    expect(rowButton(plain)).toBeNull();
  });

  it("opens the icon picker, and a pick goes to the board", async () => {
    const group = bbRow("bb-plugins", ["proj_a1:thr_1"]);
    const slot = renderOverlay([board({ icon: "🚀" })]);
    await waitFor(() => expect(rowButton(group)).not.toBeNull());

    fireEvent.click(rowButton(group)!);
    fireEvent.change(await slot.findByLabelText("Search icons"), { target: { value: "fire" } });
    fireEvent.click(await slot.findByRole("button", { name: "🔥" }));

    await waitFor(() =>
      expect(slot.inspection.rpcCalls.filter(({ method }) => method === "updateProject").map(({ input }) => input)).toEqual([
        { projectId: BOARD_ID, icon: "🔥" },
      ]),
    );
  });

  it("hangs the picker in bb's own app element, where bb lets a plugin's nodes in", async () => {
    const root = document.createElement("div");
    root.id = "root";
    root.setAttribute("data-test-sidebar", "");
    const app = document.createElement("div");
    root.append(app);
    document.body.append(root);
    const group = bbRow("bb-plugins", ["proj_a1:thr_1"]);
    const slot = renderOverlay([board({ icon: "🚀" })]);
    await waitFor(() => expect(rowButton(group)).not.toBeNull());

    fireEvent.click(rowButton(group)!);

    expect(app.contains(await slot.findByLabelText("Search icons"))).toBe(true);
  });

  it("keeps the picker open with why, when the board refuses the pick", async () => {
    const group = bbRow("bb-plugins", ["proj_a1:thr_1"]);
    const slot = renderOverlay([board({ icon: "🚀" })], () => {
      throw new Error("The board's database refused the token.");
    });
    await waitFor(() => expect(rowButton(group)).not.toBeNull());

    fireEvent.click(rowButton(group)!);
    fireEvent.change(await slot.findByLabelText("Search icons"), { target: { value: "fire" } });
    fireEvent.click(await slot.findByRole("button", { name: "🔥" }));

    expect((await slot.findByRole("alert")).textContent).toContain("refused the token");
    expect(slot.queryByLabelText("Search icons")).not.toBeNull();
  });

  it("comes off the row when the overlay goes", async () => {
    const group = bbRow("bb-plugins", []);
    const slot = renderOverlay([board()]);
    await waitFor(() => expect(rowButton(group)).not.toBeNull());

    slot.unmount();

    expect(rowButton(group)).toBeNull();
  });
});
