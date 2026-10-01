// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { planned } from "../test-support/planned.js";
import { prepareBoardDom } from "../test-support/board-harness.js";

prepareBoardDom();
const dialogPath = "./task-taken-dialog.js";
const { TakenRefusalProvider, useTakenRefusal } = await planned<typeof import("./task-taken-dialog.js")>(
  () => import(/* @vite-ignore */ dialogPath),
);

afterEach(cleanup);

const NOW = new Date("2026-09-30T12:00:03.000Z");
const takenBy = { machine: "Mac mini", threadId: "thr_x", at: "2026-09-30T12:00:00.000Z" };
const refused = { ok: false, error: { code: "task_already_taken", message: "TSK-1 is already taken on Mac mini in thread thr_x, 3 s ago", takenBy } };

/** A screen that hands one mutation result to the refusal handler and says whether it was taken care of. */
function Screen({ result }: { result: unknown }) {
  const refusal = useTakenRefusal();
  return (
    <button type="button" onClick={(event) => (event.currentTarget.dataset.handled = String(refusal.handle(result as never, "TSK-1")))}>
      Save
    </button>
  );
}

function renderScreen(result: unknown, onOpenThread = vi.fn(), wrapped = true) {
  const screenUi = <Screen result={result} />;
  render(wrapped ? <TakenRefusalProvider onOpenThread={onOpenThread} now={() => NOW}>{screenUi}</TakenRefusalProvider> : screenUi);
  const button = screen.getByRole("button", { name: "Save" });
  fireEvent.click(button);
  return { onOpenThread, handled: button.dataset.handled };
}

describe("the dialog a refused take opens", () => {
  it("names the task, the machine and how long ago, and the board it shows now", async () => {
    const { handled } = renderScreen(refused);
    expect(handled).toBe("true");
    await waitFor(() => expect(screen.queryByText("TSK-1 is already taken")).not.toBeNull());
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("Mac mini took it 3 s ago");
    expect(dialog.textContent).toContain("The board now shows it in progress.");
  });

  it("opens the thread that holds the task", async () => {
    const { onOpenThread } = renderScreen(refused);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Open thread" })).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Open thread" }));
    expect(onOpenThread).toHaveBeenCalledWith("thr_x");
  });

  it("offers no thread to open when the mark has none, and closes on OK", async () => {
    renderScreen({ ...refused, error: { ...refused.error, takenBy: { ...takenBy, threadId: null } } });
    await waitFor(() => expect(screen.queryByRole("button", { name: "OK" })).not.toBeNull());
    expect(screen.queryByRole("button", { name: "Open thread" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(screen.queryByText("TSK-1 is already taken")).toBeNull());
  });
});

describe("what the handler leaves alone", () => {
  it("any other failure: not handled, no dialog", () => {
    const { handled } = renderScreen({ ok: false, error: { code: "task_parent_invalid", message: "nope" } });
    expect(handled).toBe("false");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a screen outside the provider behaves as before: nothing is handled", () => {
    const { handled } = renderScreen(refused, vi.fn(), false);
    expect(handled).toBe("false");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
