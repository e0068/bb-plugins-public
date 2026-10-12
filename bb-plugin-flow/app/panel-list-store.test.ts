// @vitest-environment node
// Список flow в панели тредов сообщает странице, что он показан: страница прячет свой список только тогда, когда его правда видно.
import { describe, expect, it, vi } from "vitest";

import { panelListShown, registerPanelList, subscribePanelList } from "./panel-list-store";

describe("список flow показан в панели тредов", () => {
  it("пока список в панели не встал, он не показан; пока стоит — показан; ушёл — не показан", () => {
    expect(panelListShown()).toBe(false);
    const leave = registerPanelList();
    expect(panelListShown()).toBe(true);
    leave();
    expect(panelListShown()).toBe(false);
  });

  it("две панели сразу: список показан, пока стоит хотя бы одна", () => {
    const leaveFirst = registerPanelList();
    const leaveSecond = registerPanelList();
    leaveFirst();
    expect(panelListShown()).toBe(true);
    leaveSecond();
    expect(panelListShown()).toBe(false);
  });

  it("повторный уход той же панели ничего не ломает", () => {
    const leave = registerPanelList();
    const stay = registerPanelList();
    leave();
    leave();
    expect(panelListShown()).toBe(true);
    stay();
    expect(panelListShown()).toBe(false);
  });

  it("подписчик узнаёт о появлении и уходе списка и не узнаёт после отписки", () => {
    const listener = vi.fn();
    const unsubscribe = subscribePanelList(listener);
    const leave = registerPanelList();
    leave();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    registerPanelList()();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
