// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ClosedTask, ClosedTasks } from "../../shared/contract.js";
import { ClosedSection } from "./closed-section";

afterEach(cleanup);

const EDGES = [0, 100, 200, 300];
const PROJECTS = [
  { id: "P", name: "Plugins" },
  { id: "Q", name: "Quarry" },
];

function closing(over: Partial<ClosedTask>): ClosedTask {
  return { taskId: "T", key: "T-1", title: "Task", projectId: "P", atMs: 0, bin: 0, ...over };
}

function data(closings: ClosedTask[], logStartMs: number | null = null): ClosedTasks {
  return { closings, projects: PROJECTS, logStartMs };
}

const sample = data([
  closing({ taskId: "1", key: "P-1", title: "Ship the chart", projectId: "P", bin: 0, atMs: 10 }),
  closing({ taskId: "2", key: "P-2", title: "Fix the legend", projectId: "P", bin: 2, atMs: 210 }),
  closing({ taskId: "3", key: "Q-1", title: "Quarry task", projectId: "Q", bin: 2, atMs: 220 }),
]);

function renderSection(value: ClosedTasks, onOpenTask = vi.fn()) {
  const view = render(
    <ClosedSection
      title="Closed — test"
      edges={EDGES}
      data={value}
      formatBin={(startMs) => `t${startMs}`}
      onOpenTask={onOpenTask}
      chartWidth={480}
    />,
  );
  return { ...view, onOpenTask };
}

const segment = (container: HTMLElement, bin: number, projectId: string) =>
  container.querySelector(`[data-segment="${bin}:${projectId}"]`);

describe("ClosedSection", () => {
  it("draws one segment per project and column that closed something", () => {
    const { container } = renderSection(sample);
    expect(container.querySelectorAll("[data-segment]")).toHaveLength(3);
    expect(segment(container, 2, "Q")).not.toBeNull();
  });

  it("names every project that closed something in the legend", () => {
    renderSection(sample);
    expect(screen.getByText("Plugins")).toBeTruthy();
    expect(screen.getByText("Quarry")).toBeTruthy();
  });

  it("lists under the chart exactly the tasks of the clicked segment", () => {
    const { container } = renderSection(sample);
    fireEvent.click(segment(container, 2, "P")!);
    expect(screen.getByText("Fix the legend")).toBeTruthy();
    expect(screen.queryByText("Quarry task")).toBeNull();
    expect(screen.queryByText("Ship the chart")).toBeNull();
  });

  it("opens a listed task by its key", () => {
    const { container, onOpenTask } = renderSection(sample);
    fireEvent.click(segment(container, 2, "Q")!);
    fireEvent.click(screen.getByText("Quarry task"));
    expect(onOpenTask).toHaveBeenCalledWith("Q-1");
  });

  it("says so when nothing closed in the window", () => {
    renderSection(data([]));
    expect(screen.getByText("No tasks closed in this window")).toBeTruthy();
  });

  it("notes where the transition log starts when that is inside the window", () => {
    renderSection(data([], 150));
    expect(screen.getByText(/Transition log starts/)).toBeTruthy();
  });

  it("does not mention the log start when the log covers the whole window", () => {
    renderSection(data([], -50));
    expect(screen.queryByText(/Transition log starts/)).toBeNull();
  });

  it("shows a closed task that no longer exists without a way to open it", () => {
    const { container, onOpenTask } = renderSection(
      data([closing({ taskId: "gone", key: null, title: "Deleted task", projectId: "P", bin: 1, atMs: 150 })]),
    );
    fireEvent.click(segment(container, 1, "P")!);
    fireEvent.click(screen.getByText("Deleted task"));
    expect(onOpenTask).not.toHaveBeenCalled();
  });
});
