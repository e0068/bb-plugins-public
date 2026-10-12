// Список flow в левой панели bb сообщает странице Flow, что он показан: страница прячет свой список только тогда, когда
// такой же список правда виден, а не просто когда настройка включена — закреплённый в bb другой список тредов, телефон и
// выключенная настройка оставили бы владельца без списка flow нигде.
import { useSyncExternalStore } from "react";

let mounted = 0;
const listeners = new Set<() => void>();

const notify = (): void => listeners.forEach((listener) => listener());

export const panelListShown = (): boolean => mounted > 0;

export const subscribePanelList = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** Список встал в панели; возвращает уход — повторный вызов ничего не делает. */
export const registerPanelList = (): (() => void) => {
  let left = false;
  mounted += 1;
  notify();
  return () => {
    if (left) return;
    left = true;
    mounted -= 1;
    notify();
  };
};

export const usePanelListShown = (): boolean => useSyncExternalStore(subscribePanelList, panelListShown, () => false);
