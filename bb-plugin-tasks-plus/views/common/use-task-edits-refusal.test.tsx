// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { planned } from "../../test-support/planned.js";
import { boardTask, prepareBoardDom } from "../../test-support/board-harness.js";

prepareBoardDom();
await loadPluginApp(() => import("../../app"));
const { useListTaskEdits } = await import("./use-task-edits.js");
const dialogPath = "../../components/task-taken-dialog.js";
const { TakenRefusalProvider } = await planned<typeof import("../../components/task-taken-dialog.js")>(
  () => import(/* @vite-ignore */ dialogPath),
);

afterEach(cleanup);

const task = boardTask(1);
const takenBy = { machine: "MacBook", threadId: "thr_x", at: new Date().toISOString() };

function Editor({ onError }: { onError: (message: string) => void }) {
  const { edit } = useListTaskEdits([task], onError);
  return (
    <button type="button" onClick={() => edit(task, { status: "in_progress" })}>
      Take
    </button>
  );
}

function renderEditor(updateTask: () => unknown) {
  const onError = vi.fn();
  const slot = renderSlot(
    {
      component: () => (
        <TakenRefusalProvider onOpenThread={() => {}}>
          <Editor onError={onError} />
        </TakenRefusalProvider>
      ),
    },
    {},
    { rpc: { updateTask } },
  );
  fireEvent.click(slot.getByRole("button", { name: "Take" }));
  return { onError };
}

describe("a status change from the table or the task page", () => {
  it("opens the refusal dialog when another machine holds the task, instead of an error line", async () => {
    const { onError } = renderEditor(() => ({ ok: false, error: { code: "task_already_taken", message: "TSK-1 is already taken on MacBook", takenBy } }));
    await waitFor(() => expect(screen.queryByText("TSK-1 is already taken")).not.toBeNull());
    expect(onError).not.toHaveBeenCalled();
  });

  it("still reports any other failure as an error line", async () => {
    const { onError } = renderEditor(() => ({ ok: false, error: { code: "task_parent_invalid", message: "nope" } }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("nope"));
    expect(screen.queryByText("TSK-1 is already taken")).toBeNull();
  });
});
