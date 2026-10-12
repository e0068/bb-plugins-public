// Откуда слот Flow берёт содержимое левой панели. Хост bb 0.46.0 не отдаёт слотам списка тредов `Original`, поэтому после
// списка flow и `Original` (если хост его всё же отдал) идёт встроенный список bb, подключённый самим Flow, а если он не
// подключился — запасной простой список тредов.

export type BuiltinListStatus = "loading" | "ready" | "failed";

/** `pending` — встроенный список ещё подключается: слот на мгновение пуст, запасной список мигнул бы тредами без проектов. */
export type ThreadListSource = { kind: "flows"; subPath: string } | { kind: "original" } | { kind: "builtin" } | { kind: "pending" } | { kind: "fallback" };

export type ThreadListSourceInput = {
  /** Хвост адреса страницы Flow; `null`, когда окно не на странице Flow. */
  subPath: string | null;
  /** Настройка «Show flows in the threads panel» включена. */
  enabled: boolean;
  /** Хост передал слоту `Original`. */
  hostOriginal: boolean;
  builtin: BuiltinListStatus;
};

export const chooseThreadListSource = ({ subPath, enabled, hostOriginal, builtin }: ThreadListSourceInput): ThreadListSource => {
  if (enabled && subPath !== null) return { kind: "flows", subPath };
  if (hostOriginal) return { kind: "original" };
  if (builtin === "ready") return { kind: "builtin" };
  return builtin === "loading" ? { kind: "pending" } : { kind: "fallback" };
};
