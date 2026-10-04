// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { Task } from "../../shared/contract.js";

window.matchMedia ??= (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
});
window.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView ??= () => {};
window.PointerEvent ??= class extends MouseEvent {} as unknown as typeof PointerEvent;

await loadPluginApp(() => import("../../app"));
const { TaskContextMenu } = await import("./property-menus.js");

afterEach(cleanup);

const task = {
  id: "01HZZZZZZZZZZZZZZZZZZZZZT5",
  projectId: "01HZZZZZZZZZZZZZZZZZZZZZP1",
  key: "TSK-5",
  title: "Ship the rail",
  status: "todo",
  priority: "none",
  dueDate: "2026-10-05",
  startDate: null,
  labelIds: [],
} as unknown as Task;

function renderMenu() {
  const onEdit = vi.fn();
  const slot = renderSlot(
    {
      component: () => (
        <TaskContextMenu task={task} onEdit={onEdit} projectLabels={[]}>
          <div>row</div>
        </TaskContextMenu>
      ),
    },
    {},
    {},
  );
  return { slot, onEdit };
}

describe("the row menu's plan dates", () => {
  it("sets a time on the due day with the same picker", async () => {
    const { slot, onEdit } = renderMenu();
    fireEvent.contextMenu(slot.getByText("row"));
    const due = await slot.findByRole("menuitem", { name: /Due date/ });
    fireEvent.keyDown(due, { key: "ArrowRight" });
    fireEvent.change(await slot.findByLabelText("Due time"), { target: { value: "09:00" } });
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith(task, { dueDate: "2026-10-05T09:00" }));
  });
});
