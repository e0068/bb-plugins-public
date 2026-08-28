// Слой 1 — чистая работа с документом настроек Claude Code.
// Никакого ввода-вывода: на входе текст файла, на выходе новый документ.
// Все функции возвращают новый объект и не трогают исходный.

/** Состояние плагина Claude Code в одной области настроек. */
export type PluginToggle = "on" | "off" | "inherit";

/** Состояние навыка — четыре значения skillOverrides плюс «не задано». */
export type SkillState =
  | "on"
  | "name-only"
  | "user-invocable-only"
  | "off"
  | "inherit";

/** Режим подгрузки инструментов по требованию (ENABLE_TOOL_SEARCH). */
export type ToolSearchMode = "on" | "off" | "auto" | "inherit";

/** Состояние MCP-сервера в одной области: разрешён / запрещён / не задано. */
export type McpServerState = "on" | "off" | "inherit";

/** Один хук: событие, matcher (или null) и команда. */
export interface HookEntry {
  event: string;
  matcher: string | null;
  command: string;
}

export type SettingsDoc = Record<string, unknown>;

/** Файл настроек есть, но это не разбираемый JSON-объект. */
export class SettingsParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsParseError";
  }
}

const SKILL_STATES: readonly SkillState[] = [
  "on",
  "name-only",
  "user-invocable-only",
  "off",
];

/**
 * Разбирает текст файла настроек.
 *
 * `null` — файла нет, это пустой документ. А вот битый JSON — ошибка, а не
 * пустой документ: молча вернуть {} значит при первой же записи затереть
 * настройки, которые не удалось прочитать.
 */
export function parse(text: string | null): SettingsDoc {
  if (text === null) return {};
  const trimmed = text.trim();
  if (trimmed === "") return {};

  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch (error) {
    throw new SettingsParseError(
      `не разбирается как JSON: ${(error as Error).message}`,
    );
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new SettingsParseError("корень файла настроек — не объект");
  }
  return value as SettingsDoc;
}

/** Сериализует документ так же, как это делает сам Claude Code: 2 пробела. */
export function serialize(doc: SettingsDoc): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

// --- плагины -----------------------------------------------------------

export function getPlugin(doc: SettingsDoc, key: string): PluginToggle {
  const value = readRecord(doc, "enabledPlugins")[key];
  if (value === true) return "on";
  if (value === false) return "off";
  return "inherit";
}

export function setPlugin(
  doc: SettingsDoc,
  key: string,
  toggle: PluginToggle,
): SettingsDoc {
  return writeEntry(
    doc,
    "enabledPlugins",
    key,
    toggle === "inherit" ? undefined : toggle === "on",
  );
}

/** Все ключи плагинов, упомянутые в документе. */
export function listPluginKeys(doc: SettingsDoc): string[] {
  return Object.keys(readRecord(doc, "enabledPlugins"));
}

// --- навыки ------------------------------------------------------------

export function getSkill(doc: SettingsDoc, name: string): SkillState {
  const value = readRecord(doc, "skillOverrides")[name];
  return SKILL_STATES.find((state) => state === value) ?? "inherit";
}

export function setSkill(
  doc: SettingsDoc,
  name: string,
  state: SkillState,
): SettingsDoc {
  return writeEntry(
    doc,
    "skillOverrides",
    name,
    state === "inherit" ? undefined : state,
  );
}

/** Все имена навыков, упомянутые в документе. */
export function listSkillNames(doc: SettingsDoc): string[] {
  return Object.keys(readRecord(doc, "skillOverrides"));
}

// --- подгрузка инструментов -------------------------------------------

export function getToolSearch(doc: SettingsDoc): ToolSearchMode {
  const value = readRecord(doc, "env").ENABLE_TOOL_SEARCH;
  if (value === "true") return "on";
  if (value === "false") return "off";
  // Претерпит и auto, и auto:5 — порог живёт в самом значении.
  if (typeof value === "string" && value.startsWith("auto")) return "auto";
  return "inherit";
}

export function setToolSearch(
  doc: SettingsDoc,
  mode: ToolSearchMode,
): SettingsDoc {
  const value =
    mode === "inherit"
      ? undefined
      : mode === "on"
        ? "true"
        : mode === "off"
          ? "false"
          : "auto";
  return writeEntry(doc, "env", "ENABLE_TOOL_SEARCH", value);
}

// --- коннекторы (MCP-серверы) -----------------------------------------

/**
 * Действующее «своё» состояние сервера в документе. Claude Code хранит его двумя
 * массивами: `enabledMcpjsonServers` (одобрен) и `disabledMcpjsonServers`
 * (запрещён). Запрет старше разрешения: если сервер есть в обоих, читаем `off`.
 */
export function getMcpServer(doc: SettingsDoc, name: string): McpServerState {
  if (readStringArray(doc, "disabledMcpjsonServers").includes(name)) return "off";
  if (readStringArray(doc, "enabledMcpjsonServers").includes(name)) return "on";
  return "inherit";
}

/**
 * Ставит «своё» состояние сервера: `on` — в enabled и вон из disabled, `off` —
 * наоборот, `inherit` — вон из обоих. Опустевший массив убирается целиком,
 * чтобы «вернул как было» не оставляло следов.
 */
export function setMcpServer(
  doc: SettingsDoc,
  name: string,
  state: McpServerState,
): SettingsDoc {
  const withEnabled = writeArrayMember(
    doc,
    "enabledMcpjsonServers",
    name,
    state === "on",
  );
  return writeArrayMember(
    withEnabled,
    "disabledMcpjsonServers",
    name,
    state === "off",
  );
}

/** `enableAllProjectMcpServers` из документа, или undefined, если не задан. */
export function getEnableAllMcp(doc: SettingsDoc): boolean | undefined {
  const value = doc.enableAllProjectMcpServers;
  return typeof value === "boolean" ? value : undefined;
}

// --- хуки (только чтение) ---------------------------------------------

/**
 * Перечисляет все хуки документа. Структура `hooks`: событие → массив групп
 * `{ matcher?, hooks: [{ type, command }] }`. Разворачиваем в плоский список по
 * одной команде на запись. Разбор терпимый: незнакомая форма пропускается.
 */
export function listHooks(doc: SettingsDoc): HookEntry[] {
  const hooks = readRecord(doc, "hooks");
  const entries: HookEntry[] = [];
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      const record = asRecord(group);
      if (!record) continue;
      const matcher = groupMatcher(record);
      const list = Array.isArray(record.hooks) ? record.hooks : [];
      for (const hook of list) {
        const item = asRecord(hook);
        if (!item) continue;
        entries.push({ event, matcher, command: hookCommand(item) });
      }
    }
  }
  return entries;
}

// --- хуки (запись) ------------------------------------------------------

/**
 * Удаляет первый хук, совпавший по событию, matcher (`null` считается равным
 * `null`) и команде. Схлопывает опустевшие уровни структуры — группу, событие
 * и саму секцию `hooks`, — так же, как `writeEntry` для остальных секций.
 * Не нашла совпадения — возвращает исходный документ и `removed: null`.
 */
export function removeHook(
  doc: SettingsDoc,
  entry: HookEntry,
): { doc: SettingsDoc; removed: HookEntry | null } {
  const hooksSection = readRecord(doc, "hooks");
  const groups = hooksSection[entry.event];
  if (!Array.isArray(groups)) return { doc, removed: null };

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    const group = asRecord(groups[groupIndex]);
    if (!group) continue;
    const matcher = groupMatcher(group);
    if (matcher !== entry.matcher) continue;

    const list = Array.isArray(group.hooks) ? group.hooks : [];
    const hookIndex = list.findIndex((hook) => {
      const item = asRecord(hook);
      return item !== null && hookCommand(item) === entry.command;
    });
    if (hookIndex === -1) continue;

    const nextHooks = list.filter((_, i) => i !== hookIndex);
    const nextGroups =
      nextHooks.length === 0
        ? groups.filter((_, i) => i !== groupIndex)
        : groups.map((g, i) =>
            i === groupIndex ? { ...group, hooks: nextHooks } : g,
          );

    const nextHooksSection: Record<string, unknown> = { ...hooksSection };
    if (nextGroups.length === 0) delete nextHooksSection[entry.event];
    else nextHooksSection[entry.event] = nextGroups;

    const result: SettingsDoc = { ...doc };
    if (Object.keys(nextHooksSection).length === 0) delete result.hooks;
    else result.hooks = nextHooksSection;

    return { doc: result, removed: { event: entry.event, matcher, command: entry.command } };
  }
  return { doc, removed: null };
}

/**
 * Добавляет хук в `hooks[entry.event]`. Ищет группу с тем же matcher (`null`
 * — группа без поля `matcher` или с пустой строкой) и дописывает в неё
 * команду; не нашла — заводит новую группу и, если нужно, само событие.
 */
export function addHook(doc: SettingsDoc, entry: HookEntry): SettingsDoc {
  const hooksSection = readRecord(doc, "hooks");
  const groups = Array.isArray(hooksSection[entry.event])
    ? (hooksSection[entry.event] as unknown[])
    : [];

  const matchedIndex = groups.findIndex((group) => {
    const record = asRecord(group);
    return record !== null && groupMatcher(record) === entry.matcher;
  });

  const newHook = { type: "command", command: entry.command };
  const nextGroups =
    matchedIndex === -1
      ? [...groups, newGroup(entry.matcher, newHook)]
      : groups.map((group, i) => {
          if (i !== matchedIndex) return group;
          const record = asRecord(group) ?? {};
          const list = Array.isArray(record.hooks) ? record.hooks : [];
          return { ...record, hooks: [...list, newHook] };
        });

  const nextHooksSection: Record<string, unknown> = {
    ...hooksSection,
    [entry.event]: nextGroups,
  };
  return { ...doc, hooks: nextHooksSection };
}

/**
 * Заменяет команду хука с плоским индексом (порядок как в `listHooks`).
 * Индекс вне диапазона возвращает документ без изменений; event и matcher
 * не трогает.
 */
export function setHookCommandAt(
  doc: SettingsDoc,
  index: number,
  command: string,
): SettingsDoc {
  if (index < 0) return doc;
  const hooksSection = readRecord(doc, "hooks");
  const nextHooksSection: Record<string, unknown> = {};
  let counter = 0;
  let found = false;

  for (const [event, groups] of Object.entries(hooksSection)) {
    if (!Array.isArray(groups)) {
      nextHooksSection[event] = groups;
      continue;
    }
    nextHooksSection[event] = groups.map((group) => {
      const record = asRecord(group);
      if (!record) return group;
      const list = Array.isArray(record.hooks) ? record.hooks : [];
      const nextList = list.map((hook) => {
        const item = asRecord(hook);
        if (!item) return hook;
        const currentIndex = counter;
        counter += 1;
        if (currentIndex !== index) return hook;
        found = true;
        return { ...item, command };
      });
      return { ...record, hooks: nextList };
    });
  }

  if (!found) return doc;
  return { ...doc, hooks: nextHooksSection };
}

/** Matcher группы хуков: пустая строка или отсутствие поля — тоже `null`. */
function groupMatcher(group: Record<string, unknown>): string | null {
  return typeof group.matcher === "string" && group.matcher !== ""
    ? group.matcher
    : null;
}

function hookCommand(item: Record<string, unknown>): string {
  return typeof item.command === "string" ? item.command : "";
}

/** Новая группа хуков: с полем `matcher`, только когда он не `null`. */
function newGroup(
  matcher: string | null,
  hook: { type: string; command: string },
): Record<string, unknown> {
  return matcher !== null ? { matcher, hooks: [hook] } : { hooks: [hook] };
}

// --- общая механика ----------------------------------------------------

function readRecord(doc: SettingsDoc, section: string): Record<string, unknown> {
  const value = doc[section];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

/**
 * Пишет значение в секцию-объект. `undefined` удаляет ключ, а опустевшую
 * секцию убирает целиком — чтобы «вернул как было» не оставляло следов.
 */
function writeEntry(
  doc: SettingsDoc,
  section: string,
  key: string,
  value: unknown,
): SettingsDoc {
  const current = readRecord(doc, section);
  const next: Record<string, unknown> = { ...current };
  if (value === undefined) delete next[key];
  else next[key] = value;

  const result: SettingsDoc = { ...doc };
  if (Object.keys(next).length === 0) delete result[section];
  else result[section] = next;
  return result;
}

/** Массив строк из секции-массива; чужие элементы отбрасываются. */
function readStringArray(doc: SettingsDoc, section: string): string[] {
  const value = doc[section];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/**
 * Добавляет или убирает имя из секции-массива. Опустевший массив убирает
 * целиком; дубликатов не плодит. Возвращает новый документ.
 */
function writeArrayMember(
  doc: SettingsDoc,
  section: string,
  name: string,
  present: boolean,
): SettingsDoc {
  const current = readStringArray(doc, section);
  const has = current.includes(name);
  const next = present
    ? has
      ? current
      : [...current, name]
    : has
      ? current.filter((item) => item !== name)
      : current;

  const result: SettingsDoc = { ...doc };
  if (next.length === 0) delete result[section];
  else result[section] = next;
  return result;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
