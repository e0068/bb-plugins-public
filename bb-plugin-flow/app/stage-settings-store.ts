// Коллекция flow на странице Flow. Её правят список flow, таблица этапов и
// ширина кнопки — хранилище общее на страницу, чтобы сохранение одной части не
// затёрло правку другой. Пока страница не смонтирована, хранилище пустое и при
// следующем показе читает сервер заново.
import { useEffect, useSyncExternalStore } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";

import type { FlowSettings, StageCatalog, flowSettingsRpcContract } from "../shared/contract";

type Rpc = ReturnType<typeof useRpc<typeof flowSettingsRpcContract>>;

export type FlowSettingsSnapshot = { settings: FlowSettings | null; catalog: StageCatalog; failed: boolean };

const EMPTY_CATALOG: StageCatalog = { skills: [], executors: [] };
const INITIAL: FlowSettingsSnapshot = { settings: null, catalog: EMPTY_CATALOG, failed: false };

let snapshot = INITIAL;
let mounted = 0;
let rpc: Rpc | null = null;
let saving: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();

const publish = (next: FlowSettingsSnapshot) => {
  snapshot = next;
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const load = async (client: Rpc) => {
  try {
    const [settings, catalog] = await Promise.all([client.call("getFlowSettings", {}), client.call("getStageCatalog", {}).catch(() => EMPTY_CATALOG)]);
    publish({ settings, catalog, failed: false });
  } catch {
    publish({ ...snapshot, failed: true });
  }
};

/** Правка коллекции: сразу на экране; `save` — ещё и на сервер, по очереди за прежними сохранениями. Правка без изменений ничего не пишет. */
export const updateFlowSettings = (change: (settings: FlowSettings) => FlowSettings, save = true): void => {
  if (snapshot.settings === null) return;
  const next = change(snapshot.settings);
  if (next === snapshot.settings) return;
  publish({ ...snapshot, settings: next });
  if (save) commitFlowSettings();
};

/** Сохраняет то, что сейчас на экране. */
export const commitFlowSettings = (): void => {
  const client = rpc;
  const settings = snapshot.settings;
  if (client === null || settings === null) return;
  saving = saving
    .then(() => client.call("saveFlowSettings", settings))
    .then(() => snapshot.failed && publish({ ...snapshot, failed: false }))
    .catch(() => publish({ ...snapshot, failed: true }));
};

export function useFlowSettings(): FlowSettingsSnapshot {
  const client = useRpc<typeof flowSettingsRpcContract>();
  // Клиент RPC может меняться от отрисовки к отрисовке, а монтирование страницы — событие одно.
  useEffect(() => {
    rpc = client;
  });
  useEffect(() => {
    rpc = client;
    mounted += 1;
    if (mounted === 1) {
      // Сброс прошлого показа мог ещё не случиться: первый кадр — без старой коллекции.
      publish(INITIAL);
      void load(client);
    }
    return () => {
      mounted -= 1;
      // Сброс — после размонтирования всего дерева: строки успевают дописать недосохранённое название.
      setTimeout(() => {
        if (mounted > 0) return;
        rpc = null;
        snapshot = INITIAL;
      }, 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- загрузка — на первое монтирование, а не на новый объект клиента
  }, []);
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

/** Сохранённые наборы автоматизаций — из той же коллекции; строкам таблицы не нужно монтировать загрузку. */
export const useAutomationSets = () => useSyncExternalStore(subscribe, () => snapshot.settings?.automationSets ?? NO_SETS, () => NO_SETS);

const NO_SETS: NonNullable<FlowSettings["automationSets"]> = [];
