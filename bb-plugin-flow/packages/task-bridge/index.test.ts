import { describe, expect, it, vi } from "vitest";
import { OPEN_TASK_EVENT, announceTasksChanged, onOpenTask, onTasksChanged, requestOpenTask } from "./index";

const request = { taskKey: "BBPL-7", threadId: "thr_1" };

describe("просьба открыть задачу", () => {
  it("без слушателя никто не взялся", () => {
    expect(requestOpenTask(new EventTarget(), request)).toBe(false);
  });

  it("слушатель получает задачу и тред и забирает просьбу, когда открыл", () => {
    const target = new EventTarget();
    const open = vi.fn(() => true);
    onOpenTask(target, open);
    expect(requestOpenTask(target, request)).toBe(true);
    expect(open).toHaveBeenCalledWith(request);
  });

  it("не открывший слушатель просьбу не забирает", () => {
    const target = new EventTarget();
    onOpenTask(target, () => false);
    expect(requestOpenTask(target, request)).toBe(false);
  });

  it("взятую просьбу следующий слушатель не видит", () => {
    const target = new EventTarget();
    const second = vi.fn(() => true);
    onOpenTask(target, () => true);
    onOpenTask(target, second);
    requestOpenTask(target, request);
    expect(second).not.toHaveBeenCalled();
  });

  it("просьба чужой формы не доходит до слушателя", () => {
    const target = new EventTarget();
    const open = vi.fn(() => true);
    onOpenTask(target, open);
    target.dispatchEvent(new CustomEvent(OPEN_TASK_EVENT, { detail: { taskKey: 7 }, cancelable: true }));
    expect(open).not.toHaveBeenCalled();
  });

  it("после отписки слушатель молчит", () => {
    const target = new EventTarget();
    const off = onOpenTask(target, () => true);
    off();
    expect(requestOpenTask(target, request)).toBe(false);
  });
});

describe("задачи изменились", () => {
  it("доходит до каждого слушателя, пока он подписан", () => {
    const target = new EventTarget();
    const changed = vi.fn();
    const off = onTasksChanged(target, changed);
    announceTasksChanged(target);
    off();
    announceTasksChanged(target);
    expect(changed).toHaveBeenCalledTimes(1);
  });
});
