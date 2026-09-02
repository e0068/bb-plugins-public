// Layer 1 — pure work with the Claude Code settings document.
// No I/O at all: input is file text, output is a new document.
// Every function returns a new object and leaves the source untouched.

/** State of a Claude Code plugin in one settings scope. */
export type PluginToggle = "on" | "off" | "inherit";

/** Skill state — the four skillOverrides values plus "unset". */
export type SkillState =
  | "on"
  | "name-only"
  | "user-invocable-only"
  | "off"
  | "inherit";

/** On-demand tool loading mode (ENABLE_TOOL_SEARCH). */
export type ToolSearchMode = "on" | "off" | "auto" | "inherit";

/** State of an MCP server in one scope: allowed / denied / unset. */
export type McpServerState = "on" | "off" | "inherit";

/** One hook: event, matcher (or null), and command. */
export interface HookEntry {
  event: string;
  matcher: string | null;
  command: string;
}

export type SettingsDoc = Record<string, unknown>;

/** The settings file exists but isn't a parseable JSON object. */
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
 * Parses the text of a settings file.
 *
 * `null` means no file, which is an empty document. Broken JSON, though, is
 * an error, not an empty document: silently returning {} would mean the
 * very next write wipes out settings that couldn't be read.
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
      `does not parse as JSON: ${(error as Error).message}`,
    );
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new SettingsParseError("settings file root is not an object");
  }
  return value as SettingsDoc;
}

/** Serializes the document the same way Claude Code itself does: 2 spaces. */
export function serialize(doc: SettingsDoc): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

// --- plugins -------------------------------------------------------------

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

/** All plugin keys mentioned in the document. */
export function listPluginKeys(doc: SettingsDoc): string[] {
  return Object.keys(readRecord(doc, "enabledPlugins"));
}

// --- skills ----------------------------------------------------------------

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

/** All skill names mentioned in the document. */
export function listSkillNames(doc: SettingsDoc): string[] {
  return Object.keys(readRecord(doc, "skillOverrides"));
}

// --- tool loading ------------------------------------------------------

export function getToolSearch(doc: SettingsDoc): ToolSearchMode {
  const value = readRecord(doc, "env").ENABLE_TOOL_SEARCH;
  if (value === "true") return "on";
  if (value === "false") return "off";
  // Matches both auto and auto:5 — the threshold lives in the value itself.
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

// --- connectors (MCP servers) ------------------------------------------

/**
 * The server's effective "own" state in the document. Claude Code stores it
 * in two arrays: `enabledMcpjsonServers` (approved) and
 * `disabledMcpjsonServers` (denied). A denial outranks an approval: if the
 * server is in both, we read `off`.
 */
export function getMcpServer(doc: SettingsDoc, name: string): McpServerState {
  if (readStringArray(doc, "disabledMcpjsonServers").includes(name)) return "off";
  if (readStringArray(doc, "enabledMcpjsonServers").includes(name)) return "on";
  return "inherit";
}

/**
 * Sets the server's "own" state: `on` — into enabled and out of disabled,
 * `off` — the reverse, `inherit` — out of both. An emptied array is removed
 * entirely, so "reverted to how it was" leaves no trace.
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

/** `enableAllProjectMcpServers` from the document, or undefined if unset. */
export function getEnableAllMcp(doc: SettingsDoc): boolean | undefined {
  const value = doc.enableAllProjectMcpServers;
  return typeof value === "boolean" ? value : undefined;
}

// --- hooks (read-only) --------------------------------------------------

/**
 * Lists all hooks in the document. The `hooks` structure: event → array of
 * groups `{ matcher?, hooks: [{ type, command }] }`. Unrolled into a flat
 * list, one command per entry. Parsing is lenient: an unfamiliar shape is
 * skipped.
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

// --- hooks (write) --------------------------------------------------------

/**
 * Removes the first hook matching by event, matcher (`null` is considered
 * equal to `null`) and command. Collapses emptied levels of the structure —
 * the group, the event, and the `hooks` section itself — the same way
 * `writeEntry` does for the other sections. No match found — returns the
 * original document and `removed: null`.
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
 * Replaces one hook's whole identity: removes `oldEntry` (by event/matcher/
 * command) and adds `newEntry` in its place — which moves it to a different
 * event or matcher group when those changed. `oldEntry` not found — the
 * document is returned unchanged and `replaced: false`, same "no-op, not a
 * write" contract as `removeHook`.
 */
export function replaceHook(
  doc: SettingsDoc,
  oldEntry: HookEntry,
  newEntry: HookEntry,
): { doc: SettingsDoc; replaced: boolean } {
  const { doc: withoutOld, removed } = removeHook(doc, oldEntry);
  if (!removed) return { doc, replaced: false };
  return { doc: addHook(withoutOld, newEntry), replaced: true };
}

/**
 * Adds a hook to `hooks[entry.event]`. Looks for a group with the same
 * matcher (`null` — a group with no `matcher` field or an empty string) and
 * appends the command to it; if not found, creates a new group and, if
 * needed, the event itself.
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

/** The "Definition" JSON text (see `hookDefinitionJson` in server.ts) doesn't parse into one hook. */
export class HookDefinitionParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HookDefinitionParseError";
  }
}

/**
 * Parses one hook's "Definition" JSON — `{ [event]: [{ matcher?, hooks:
 * [{ type: "command", command }] }] }`, the exact shape `hookDefinitionJson`
 * renders — back into a `HookEntry`. Anything outside that shape (more than
 * one event, group, or hook; a non-command type) is a validation message,
 * not a silent guess at what the user meant.
 */
export function parseHookDefinitionJson(text: string): HookEntry {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new HookDefinitionParseError("Invalid JSON.");
  }
  const root = asRecord(value);
  const events = root ? Object.keys(root) : [];
  if (!root || events.length !== 1) {
    throw new HookDefinitionParseError(
      "Definition must have exactly one event key.",
    );
  }
  const [event] = events;
  const groups = root[event];
  if (!Array.isArray(groups) || groups.length !== 1) {
    throw new HookDefinitionParseError(
      "Definition must have exactly one matcher group.",
    );
  }
  const group = asRecord(groups[0]);
  const hooksList = group?.hooks;
  if (!group || !Array.isArray(hooksList) || hooksList.length !== 1) {
    throw new HookDefinitionParseError("Definition must have exactly one hook.");
  }
  const hookItem = asRecord(hooksList[0]);
  if (!hookItem || hookItem.type !== "command" || typeof hookItem.command !== "string") {
    throw new HookDefinitionParseError(
      'Hook must be {"type": "command", "command": "..."}.',
    );
  }
  return { event, matcher: groupMatcher(group), command: hookItem.command };
}

/**
 * Replaces a hook's command by flat index (order matches `listHooks`).
 * An out-of-range index returns the document unchanged; event and matcher
 * are left untouched.
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

/** Matcher of a hook group: an empty string or a missing field also means `null`. */
function groupMatcher(group: Record<string, unknown>): string | null {
  return typeof group.matcher === "string" && group.matcher !== ""
    ? group.matcher
    : null;
}

function hookCommand(item: Record<string, unknown>): string {
  return typeof item.command === "string" ? item.command : "";
}

/** A new hook group: includes the `matcher` field only when it isn't `null`. */
function newGroup(
  matcher: string | null,
  hook: { type: string; command: string },
): Record<string, unknown> {
  return matcher !== null ? { matcher, hooks: [hook] } : { hooks: [hook] };
}

// --- shared machinery ----------------------------------------------------

function readRecord(doc: SettingsDoc, section: string): Record<string, unknown> {
  const value = doc[section];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

/**
 * Writes a value into an object-shaped section. `undefined` deletes the
 * key, and an emptied section is removed entirely — so "reverted to how it
 * was" leaves no trace.
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

/** String array from an array-shaped section; foreign elements are dropped. */
function readStringArray(doc: SettingsDoc, section: string): string[] {
  const value = doc[section];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/**
 * Adds or removes a name from an array-shaped section. Removes an emptied
 * array entirely; never produces duplicates. Returns a new document.
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
