// Встроенный список тредов bb в слоте Flow. Хост 0.46.0 не отдаёт слотам списка тредов `Original`, но список — обычный плагин
// `thread-list`: его фронтенд лежит по адресу из `/api/v1/plugins`. Flow подключает этот файл, вызывает его `setup` с заглушкой
// приложения и забирает компонент, который плагин регистрирует в слоте списка тредов. Настройки списка он спрашивает у Flow
// (слот держит Flow), и сервер Flow пересылает их в thread-list (`server/thread-list-prefs-api.ts`). Устройство бандла —
// внутренность bb: не подошло — `null`, и слот показывает запасной список.
import { useEffect, useState, type ComponentType } from "react";
import type { PluginThreadListProps } from "@get-bb/plugin-sdk/app";

export type ThreadListComponent = ComponentType<Omit<PluginThreadListProps, "Original">>;

export type BuiltinThreadListDeps = {
  fetchPlugins: () => Promise<unknown>;
  importBundle: (jsUrl: string) => Promise<unknown>;
};

export type BuiltinListState = { status: "loading" } | { status: "ready"; Component: ThreadListComponent } | { status: "failed" };

const BUILTIN_PLUGIN_ID = "thread-list";
const BUILTIN_SLOT_ID = "thread-list";

type Registration = { id?: unknown; component?: unknown };
type Plugin = { setup: (app: unknown) => void };

/** Любое обращение плагина к приложению, кроме слотов, ни на что не влияет: заглушка отвечает самой собой. */
const inert = (): unknown => new Proxy(function () {}, { get: () => inert(), apply: () => inert() });

const jsUrlOf = (plugins: unknown): string | null => {
  const list = (plugins as { plugins?: unknown } | null)?.plugins;
  if (!Array.isArray(list)) return null;
  const url = list.find((plugin) => plugin?.id === BUILTIN_PLUGIN_ID)?.app?.bundle?.jsUrl;
  return typeof url === "string" ? url : null;
};

/** Регистрации слота списка тредов, которые плагин делает в `setup`. */
const threadListRegistrations = (plugin: Plugin): Registration[] => {
  const registered: Registration[] = [];
  const slots = new Proxy({}, { get: (_, slot) => (slot === "experimental_threadList" ? (registration: Registration) => void registered.push(registration) : inert()) });
  plugin.setup(new Proxy({}, { get: (_, key) => (key === "slots" ? slots : inert()) }));
  return registered;
};

const pickComponent = (registered: Registration[]): ThreadListComponent | null => {
  const candidates = registered.filter((registration) => typeof registration?.component === "function");
  return ((candidates.find((registration) => registration.id === BUILTIN_SLOT_ID) ?? candidates[0])?.component as ThreadListComponent | undefined) ?? null;
};

const loadOnce = async ({ fetchPlugins, importBundle }: BuiltinThreadListDeps): Promise<ThreadListComponent | null> => {
  try {
    const jsUrl = jsUrlOf(await fetchPlugins());
    if (jsUrl === null) return null;
    const plugin = ((await importBundle(jsUrl)) as { default?: { setup?: unknown } } | null)?.default;
    return typeof plugin?.setup === "function" ? pickComponent(threadListRegistrations(plugin as Plugin)) : null;
  } catch {
    return null;
  }
};

/** Загрузчик, который подключает встроенный список один раз; неудача не запоминается — следующий вызов пробует снова. */
export const createBuiltinThreadListLoader = (deps: BuiltinThreadListDeps): (() => Promise<ThreadListComponent | null>) => {
  let loading: Promise<ThreadListComponent | null> | undefined;
  return () =>
    (loading ??= loadOnce(deps).then((component) => {
      if (component === null) loading = undefined;
      return component;
    }));
};

const browserLoader = createBuiltinThreadListLoader({
  fetchPlugins: async () => (await fetch("/api/v1/plugins")).json(),
  importBundle: (jsUrl) => import(/* @vite-ignore */ jsUrl),
});

/** Встроенный список bb; грузится только когда `needed` — слоту, который показывает flow или `Original` хоста, он не нужен. */
export function useBuiltinThreadList(needed: boolean, load: () => Promise<ThreadListComponent | null> = browserLoader): BuiltinListState {
  const [state, setState] = useState<BuiltinListState>({ status: "loading" });
  useEffect(() => {
    if (!needed) return;
    let cancelled = false;
    void load().then((Component) => {
      if (!cancelled) setState(Component === null ? { status: "failed" } : { status: "ready", Component });
    });
    return () => {
      cancelled = true;
    };
  }, [needed, load]);
  return state;
}
