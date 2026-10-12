// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { blankPhase, blankTree } from "../model";
import { createEditorStore, type EditorStore } from "../store";
import { EditorStoreContext } from "./context";
import { WorkflowEditor } from "./workflow-editor";

afterEach(cleanup);

const file = { store: "global" as const, path: "/home/u/.claude/workflows/epic.js", name: "epic" };

const show = (store: EditorStore) =>
  render(
    <EditorStoreContext.Provider value={store}>
      <WorkflowEditor agents={[]} providerCatalog={[]} previewEngine="claude" columns="all" selectedPath={null} onSelect={() => {}} storageKey="test" />
    </EditorStoreContext.Provider>,
  );

describe("WorkflowEditor", () => {
  it("a hand-written file opens as code under its reason", () => {
    const store = createEditorStore();
    store.load(blankTree("epic"), file, "export const meta = {}", "hand-written");
    show(store);
    expect(screen.getByText(/No builder mark — written by hand/)).toBeTruthy();
    expect(screen.getByLabelText("workflow source").textContent).toBe("export const meta = {}");
  });

  it("a file edited after saving names that reason instead", () => {
    const store = createEditorStore();
    store.load(blankTree("lead-waves"), file, "// edited", "edited");
    show(store);
    expect(screen.getByText(/Edited by hand after saving/)).toBeTruthy();
    expect(screen.queryByText(/No builder mark/)).toBeNull();
  });

  it("a recognized file opens as a tree, and two stores keep their own trees", () => {
    const first = createEditorStore();
    const second = createEditorStore();
    first.load(blankTree("first"), file);
    second.load(blankTree("second"), { ...file, name: "second" });
    show(first);
    act(() => second.setName("renamed"));
    expect((screen.getByLabelText("outline workflow name") as HTMLInputElement).value).toBe("first");
    expect(screen.queryByLabelText("workflow source")).toBeNull();
  });

  it("a picked node's settings keep a readable width beside the tree — a narrow tab scrolls instead of squeezing them", () => {
    const store = createEditorStore();
    store.load({ ...blankTree("review"), phases: [blankPhase("Review")] }, file);
    render(
      <EditorStoreContext.Provider value={store}>
        <WorkflowEditor agents={[]} providerCatalog={[]} previewEngine="claude" columns="all" selectedPath={[0]} onSelect={() => {}} storageKey="test" />
      </EditorStoreContext.Provider>,
    );
    expect(screen.getByLabelText("outline workflow name")).toBeTruthy();
    const column = screen.getByLabelText("group repeat max loops").closest<HTMLElement>("[style]")!;
    expect(column.style.minWidth).toBe("280px");
  });
});
