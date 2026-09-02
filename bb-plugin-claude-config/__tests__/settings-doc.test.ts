import { describe, expect, it } from "vitest";

import {
  HookDefinitionParseError,
  SettingsParseError,
  addHook,
  getEnableAllMcp,
  getMcpServer,
  getPlugin,
  getSkill,
  getToolSearch,
  listHooks,
  listPluginKeys,
  listSkillNames,
  parse,
  parseHookDefinitionJson,
  removeHook,
  replaceHook,
  serialize,
  setHookCommandAt,
  setMcpServer,
  setPlugin,
  setSkill,
  setToolSearch,
  type HookEntry,
} from "../src/settings-doc";

describe("parse", () => {
  it("treats a missing or empty file as an empty document", () => {
    expect(parse(null)).toEqual({});
    expect(parse("")).toEqual({});
    expect(parse("   \n ")).toEqual({});
  });

  it("parses a settings object", () => {
    expect(parse('{"theme":"light"}')).toEqual({ theme: "light" });
  });

  it("doesn't replace broken JSON with an empty document", () => {
    // Otherwise the very first write would overwrite a file that failed to parse.
    expect(() => parse("{ oops")).toThrow(SettingsParseError);
  });

  it("rejects a root that isn't an object", () => {
    expect(() => parse("[1,2]")).toThrow(SettingsParseError);
    expect(() => parse('"string"')).toThrow(SettingsParseError);
    expect(() => parse("null")).toThrow(SettingsParseError);
  });
});

describe("serialize", () => {
  it("writes with two-space indentation and a trailing newline", () => {
    expect(serialize({ a: 1 })).toBe('{\n  "a": 1\n}\n');
  });
});

describe("plugins", () => {
  const doc = parse('{"enabledPlugins":{"figma@m":true,"telegram@m":false}}');

  it("reads all three states", () => {
    expect(getPlugin(doc, "figma@m")).toBe("on");
    expect(getPlugin(doc, "telegram@m")).toBe("off");
    expect(getPlugin(doc, "unknown@m")).toBe("inherit");
  });

  it("lists the mentioned keys", () => {
    expect(listPluginKeys(doc)).toEqual(["figma@m", "telegram@m"]);
  });

  it("turns on and off without touching the source document", () => {
    const next = setPlugin(doc, "telegram@m", "on");
    expect(getPlugin(next, "telegram@m")).toBe("on");
    expect(getPlugin(doc, "telegram@m")).toBe("off");
  });

  it("reverting to inherit removes the key", () => {
    const next = setPlugin(doc, "figma@m", "inherit");
    expect(listPluginKeys(next)).toEqual(["telegram@m"]);
  });

  it("removes an emptied section entirely", () => {
    let next = setPlugin(doc, "figma@m", "inherit");
    next = setPlugin(next, "telegram@m", "inherit");
    expect(next).toEqual({});
  });

  it("creates the section when it didn't exist", () => {
    expect(setPlugin({}, "figma@m", "off")).toEqual({
      enabledPlugins: { "figma@m": false },
    });
  });

  it("doesn't lose neighboring document keys", () => {
    const withTheme = parse('{"theme":"light","enabledPlugins":{"a@m":true}}');
    const next = setPlugin(withTheme, "a@m", "off");
    expect(next.theme).toBe("light");
  });

  it("treats garbage in the section as a missing section, not a crash", () => {
    const broken = parse('{"enabledPlugins":"garbage"}');
    expect(getPlugin(broken, "a@m")).toBe("inherit");
    expect(setPlugin(broken, "a@m", "on")).toEqual({
      enabledPlugins: { "a@m": true },
    });
  });
});

describe("skills", () => {
  const doc = parse('{"skillOverrides":{"deploy":"off","legacy":"name-only"}}');

  it("reads known states and ignores unknown ones", () => {
    expect(getSkill(doc, "deploy")).toBe("off");
    expect(getSkill(doc, "legacy")).toBe("name-only");
    expect(getSkill(doc, "absent")).toBe("inherit");
    expect(getSkill(parse('{"skillOverrides":{"x":"garbage"}}'), "x")).toBe(
      "inherit",
    );
  });

  it("lists the mentioned names", () => {
    expect(listSkillNames(doc)).toEqual(["deploy", "legacy"]);
  });

  it("writes and clears a state", () => {
    const next = setSkill(doc, "deploy", "user-invocable-only");
    expect(getSkill(next, "deploy")).toBe("user-invocable-only");
    expect(listSkillNames(setSkill(next, "deploy", "inherit"))).toEqual([
      "legacy",
    ]);
  });
});

describe("connectors (MCP servers)", () => {
  const doc = parse(
    '{"enabledMcpjsonServers":["a"],"disabledMcpjsonServers":["b"]}',
  );

  it("reads all three states; a denial outranks an allow", () => {
    expect(getMcpServer(doc, "a")).toBe("on");
    expect(getMcpServer(doc, "b")).toBe("off");
    expect(getMcpServer(doc, "c")).toBe("inherit");
    const both = parse(
      '{"enabledMcpjsonServers":["x"],"disabledMcpjsonServers":["x"]}',
    );
    expect(getMcpServer(both, "x")).toBe("off");
  });

  it("on/off edit both arrays, inherit removes from both", () => {
    const on = setMcpServer(doc, "c", "on");
    expect(getMcpServer(on, "c")).toBe("on");
    // Flipping b from off to on removes it from disabled.
    const flipped = setMcpServer(doc, "b", "on");
    expect(flipped.disabledMcpjsonServers).toBeUndefined();
    expect(getMcpServer(flipped, "b")).toBe("on");
    // inherit drops the entry entirely; emptied arrays go away.
    const cleared = setMcpServer(setMcpServer(doc, "a", "inherit"), "b", "inherit");
    expect(cleared).toEqual({});
  });

  it("doesn't touch the source document or neighboring keys", () => {
    const withTheme = parse('{"theme":"dark","enabledMcpjsonServers":["a"]}');
    const next = setMcpServer(withTheme, "a", "off");
    expect(next.theme).toBe("dark");
    expect(getMcpServer(withTheme, "a")).toBe("on");
  });

  it("reads enableAllProjectMcpServers", () => {
    expect(getEnableAllMcp({})).toBeUndefined();
    expect(getEnableAllMcp(parse('{"enableAllProjectMcpServers":true}'))).toBe(
      true,
    );
    expect(getEnableAllMcp(parse('{"enableAllProjectMcpServers":false}'))).toBe(
      false,
    );
  });
});

describe("hooks", () => {
  it("unfolds events and groups into a flat list", () => {
    const doc = parse(
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: "Bash", hooks: [{ type: "command", command: "lint" }] },
          ],
          UserPromptSubmit: [
            {
              hooks: [
                { type: "command", command: "one" },
                { type: "command", command: "two" },
              ],
            },
          ],
        },
      }),
    );
    expect(listHooks(doc)).toEqual([
      { event: "PreToolUse", matcher: "Bash", command: "lint" },
      { event: "UserPromptSubmit", matcher: null, command: "one" },
      { event: "UserPromptSubmit", matcher: null, command: "two" },
    ]);
  });

  it("an empty matcher counts as missing, garbage is skipped", () => {
    const doc = parse(
      JSON.stringify({
        hooks: {
          Stop: [{ matcher: "", hooks: [{ type: "command", command: "x" }] }],
          Bad: "garbage",
        },
      }),
    );
    expect(listHooks(doc)).toEqual([
      { event: "Stop", matcher: null, command: "x" },
    ]);
  });

  it("no hooks key — empty list", () => {
    expect(listHooks({})).toEqual([]);
  });
});

describe("removeHook", () => {
  function docWith(hooks: unknown): ReturnType<typeof parse> {
    return parse(JSON.stringify({ hooks }));
  }

  it("removes one hook from a group with several — the group remains", () => {
    const doc = docWith({
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [
            { type: "command", command: "one" },
            { type: "command", command: "two" },
          ],
        },
      ],
    });
    const { doc: next, removed } = removeHook(doc, {
      event: "PreToolUse",
      matcher: "Bash",
      command: "one",
    });
    expect(removed).toEqual({ event: "PreToolUse", matcher: "Bash", command: "one" });
    expect(listHooks(next)).toEqual([
      { event: "PreToolUse", matcher: "Bash", command: "two" },
    ]);
  });

  it("removes a group's last hook — the group disappears, the event remains", () => {
    const doc = docWith({
      PreToolUse: [
        { matcher: "Bash", hooks: [{ type: "command", command: "lint" }] },
        { matcher: "Edit", hooks: [{ type: "command", command: "fmt" }] },
      ],
    });
    const { doc: next } = removeHook(doc, {
      event: "PreToolUse",
      matcher: "Bash",
      command: "lint",
    });
    expect(listHooks(next)).toEqual([
      { event: "PreToolUse", matcher: "Edit", command: "fmt" },
    ]);
  });

  it("removes an event's last hook — the event key disappears", () => {
    const doc = docWith({
      Stop: [{ hooks: [{ type: "command", command: "notify" }] }],
      Other: [{ hooks: [{ type: "command", command: "x" }] }],
    });
    const { doc: next } = removeHook(doc, {
      event: "Stop",
      matcher: null,
      command: "notify",
    });
    expect((next.hooks as Record<string, unknown>).Stop).toBeUndefined();
    expect(listHooks(next)).toEqual([
      { event: "Other", matcher: null, command: "x" },
    ]);
  });

  it("removes the very last hook — the hooks section disappears entirely", () => {
    const doc = docWith({
      Stop: [{ hooks: [{ type: "command", command: "notify" }] }],
    });
    const { doc: next } = removeHook(doc, {
      event: "Stop",
      matcher: null,
      command: "notify",
    });
    expect(next).toEqual({});
  });

  it("an entry that isn't found — removed:null, document unchanged", () => {
    const doc = docWith({
      Stop: [{ hooks: [{ type: "command", command: "notify" }] }],
    });
    const { doc: next, removed } = removeHook(doc, {
      event: "Stop",
      matcher: null,
      command: "absent",
    });
    expect(removed).toBeNull();
    expect(next).toEqual(doc);
  });

  it("a null matcher and a string matcher are distinct", () => {
    const doc = docWith({
      Stop: [
        { hooks: [{ type: "command", command: "x" }] },
        { matcher: "Bash", hooks: [{ type: "command", command: "x" }] },
      ],
    });
    const { doc: next } = removeHook(doc, {
      event: "Stop",
      matcher: "Bash",
      command: "x",
    });
    expect(listHooks(next)).toEqual([{ event: "Stop", matcher: null, command: "x" }]);
  });
});

describe("addHook", () => {
  it("adds to an existing group with the same matcher", () => {
    const doc = docWithHooksSection({
      PreToolUse: [
        { matcher: "Bash", hooks: [{ type: "command", command: "lint" }] },
      ],
    });
    const next = addHook(doc, { event: "PreToolUse", matcher: "Bash", command: "fmt" });
    expect(listHooks(next)).toEqual([
      { event: "PreToolUse", matcher: "Bash", command: "lint" },
      { event: "PreToolUse", matcher: "Bash", command: "fmt" },
    ]);
  });

  it("creates a new group for a different matcher", () => {
    const doc = docWithHooksSection({
      PreToolUse: [
        { matcher: "Bash", hooks: [{ type: "command", command: "lint" }] },
      ],
    });
    const next = addHook(doc, { event: "PreToolUse", matcher: "Edit", command: "fmt" });
    expect(listHooks(next)).toEqual([
      { event: "PreToolUse", matcher: "Bash", command: "lint" },
      { event: "PreToolUse", matcher: "Edit", command: "fmt" },
    ]);
  });

  it("creates a new event if it didn't exist", () => {
    const next = addHook({}, { event: "Stop", matcher: null, command: "notify" });
    expect(listHooks(next)).toEqual([{ event: "Stop", matcher: null, command: "notify" }]);
  });

  it("a null matcher creates a group without a matcher field", () => {
    const next = addHook({}, { event: "Stop", matcher: null, command: "notify" });
    const groups = (next.hooks as Record<string, unknown>).Stop as Record<string, unknown>[];
    expect(groups[0]).not.toHaveProperty("matcher");
  });

  it("round-trip: removeHook(addHook(doc, e), e) returns e", () => {
    const doc = docWithHooksSection({
      PreToolUse: [
        { matcher: "Bash", hooks: [{ type: "command", command: "lint" }] },
      ],
    });
    const entry: HookEntry = { event: "Stop", matcher: "Task", command: "notify" };
    const { removed } = removeHook(addHook(doc, entry), entry);
    expect(removed).toEqual(entry);
  });

  function docWithHooksSection(hooks: unknown): ReturnType<typeof parse> {
    return parse(JSON.stringify({ hooks }));
  }
});

describe("setHookCommandAt", () => {
  const doc = parse(
    JSON.stringify({
      hooks: {
        PreToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "lint" }] },
        ],
        Stop: [
          {
            hooks: [
              { type: "command", command: "one" },
              { type: "command", command: "two" },
            ],
          },
        ],
      },
    }),
  );

  it("changes the command by flat index, without touching its neighbors", () => {
    const next = setHookCommandAt(doc, 1, "one-changed");
    expect(listHooks(next)).toEqual([
      { event: "PreToolUse", matcher: "Bash", command: "lint" },
      { event: "Stop", matcher: null, command: "one-changed" },
      { event: "Stop", matcher: null, command: "two" },
    ]);
  });

  it("preserves the hook's event and matcher", () => {
    const next = setHookCommandAt(doc, 0, "fmt");
    expect(listHooks(next)[0]).toEqual({
      event: "PreToolUse",
      matcher: "Bash",
      command: "fmt",
    });
  });

  it("index out of range — document unchanged", () => {
    expect(setHookCommandAt(doc, 99, "x")).toEqual(doc);
    expect(setHookCommandAt(doc, -1, "x")).toEqual(doc);
  });
});

describe("replaceHook", () => {
  const doc = parse(
    JSON.stringify({
      hooks: {
        PreToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "lint" }] },
        ],
      },
    }),
  );
  const oldEntry: HookEntry = {
    event: "PreToolUse",
    matcher: "Bash",
    command: "lint",
  };

  it("changes the command in place", () => {
    const { doc: next, replaced } = replaceHook(doc, oldEntry, {
      ...oldEntry,
      command: "lint --fix",
    });
    expect(replaced).toBe(true);
    expect(listHooks(next)).toEqual([
      { event: "PreToolUse", matcher: "Bash", command: "lint --fix" },
    ]);
  });

  it("moves the hook to a different matcher group", () => {
    const { doc: next } = replaceHook(doc, oldEntry, {
      ...oldEntry,
      matcher: "Edit",
    });
    expect(listHooks(next)).toEqual([
      { event: "PreToolUse", matcher: "Edit", command: "lint" },
    ]);
  });

  it("moves the hook to a different event", () => {
    const { doc: next } = replaceHook(doc, oldEntry, {
      ...oldEntry,
      event: "Stop",
    });
    expect(listHooks(next)).toEqual([
      { event: "Stop", matcher: "Bash", command: "lint" },
    ]);
  });

  it("old entry not found — document unchanged, replaced: false", () => {
    const result = replaceHook(
      doc,
      { event: "Stop", matcher: null, command: "missing" },
      { event: "Stop", matcher: null, command: "x" },
    );
    expect(result).toEqual({ doc, replaced: false });
  });
});

describe("parseHookDefinitionJson", () => {
  it("parses a definition with a matcher", () => {
    const text = JSON.stringify({
      PreToolUse: [
        { matcher: "Bash", hooks: [{ type: "command", command: "lint" }] },
      ],
    });
    expect(parseHookDefinitionJson(text)).toEqual({
      event: "PreToolUse",
      matcher: "Bash",
      command: "lint",
    });
  });

  it("parses a definition without a matcher", () => {
    const text = JSON.stringify({
      Stop: [{ hooks: [{ type: "command", command: "notify" }] }],
    });
    expect(parseHookDefinitionJson(text)).toEqual({
      event: "Stop",
      matcher: null,
      command: "notify",
    });
  });

  it.each([
    ["invalid JSON", "{not json"],
    ["no event key", "{}"],
    ["two event keys", JSON.stringify({ Stop: [], PreToolUse: [] })],
    [
      "two matcher groups",
      JSON.stringify({
        Stop: [
          { hooks: [{ type: "command", command: "a" }] },
          { hooks: [{ type: "command", command: "b" }] },
        ],
      }),
    ],
    [
      "two hooks in the group",
      JSON.stringify({
        Stop: [
          {
            hooks: [
              { type: "command", command: "a" },
              { type: "command", command: "b" },
            ],
          },
        ],
      }),
    ],
    [
      "non-command hook type",
      JSON.stringify({ Stop: [{ hooks: [{ type: "other", command: "a" }] }] }),
    ],
  ])("rejects: %s", (_label, text) => {
    expect(() => parseHookDefinitionJson(text)).toThrow(
      HookDefinitionParseError,
    );
  });

  it("round-trips through addHook/listHooks", () => {
    const entry: HookEntry = {
      event: "PreToolUse",
      matcher: "Edit",
      command: "fmt",
    };
    const text = JSON.stringify({
      [entry.event]: [
        { matcher: entry.matcher, hooks: [{ type: "command", command: entry.command }] },
      ],
    });
    expect(parseHookDefinitionJson(text)).toEqual(entry);
  });
});

describe("tool search", () => {
  it("reads every form of the value", () => {
    expect(getToolSearch({})).toBe("inherit");
    expect(getToolSearch(parse('{"env":{"ENABLE_TOOL_SEARCH":"true"}}'))).toBe(
      "on",
    );
    expect(getToolSearch(parse('{"env":{"ENABLE_TOOL_SEARCH":"false"}}'))).toBe(
      "off",
    );
    expect(getToolSearch(parse('{"env":{"ENABLE_TOOL_SEARCH":"auto"}}'))).toBe(
      "auto",
    );
    // The threshold lives inside the value; the mode is the same.
    expect(
      getToolSearch(parse('{"env":{"ENABLE_TOOL_SEARCH":"auto:5"}}')),
    ).toBe("auto");
  });

  it("writes the value into env and removes it when reverted", () => {
    const on = setToolSearch({}, "off");
    expect(on).toEqual({ env: { ENABLE_TOOL_SEARCH: "false" } });
    expect(setToolSearch(on, "inherit")).toEqual({});
  });

  it("doesn't wipe out neighboring environment variables", () => {
    const doc = parse('{"env":{"DEBUG":"1","ENABLE_TOOL_SEARCH":"false"}}');
    expect(setToolSearch(doc, "inherit")).toEqual({ env: { DEBUG: "1" } });
  });
});
