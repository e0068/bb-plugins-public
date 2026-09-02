# Claude Config — config panel

A **bb** plugin that edits the **Claude Code** config: which plugins,
connectors and skills are loaded, which hooks are configured, and whether
tools are loaded up front or on demand. Everything is scoped: separately
global, separately per project.

## Why

Claude Code plugins and skills are enabled by default at the user level and
from then on load into every session in every project. State is spread
across four levels of settings, the list of what's installed lives in a
fifth place, and untangling it by hand from the files is hard. The panel
shows the effective value and lets you toggle it in the right scope.

## What it toggles

| Section | Settings key | States |
| --- | --- | --- |
| Claude Code plugins | `enabledPlugins` | on / off / inherit |
| Connectors | `enabledMcpjsonServers` / `disabledMcpjsonServers` | on / off / inherit |
| Skills | `skillOverrides` | full / name-only / slash-only / disabled / inherit |
| Agents | `agents/` files | view and create only |
| Hooks | `hooks` | view only |
| Tool loading | `env.ENABLE_TOOL_SEARCH` | on / off / auto / inherit |

Skills that come from plugins don't show up in the list: `skillOverrides`
doesn't apply to them — they're disabled by disabling the plugin itself.

**Skills and agents** can be created right from the panel — a button in the
section header asks for a name, normalizes it into a slug, drops a
scaffold into the scope's directory (project, if a project is open,
otherwise personal) and opens the file for editing: a skill goes to
`<skills dir>/<name>/SKILL.md`, an agent to `<agents dir>/<name>.md`.
Agents aren't gated by settings, so that section has no toggles — just a
list and a create action; clicking a row opens the agent file.

## What opens the files

Real files (a skill, an agent, a memory doc, links inside docs, the file a
hook points to) open according to the plugin's **"What opens files"**
setting (`fileOpener`, on the Extensions → Plugins page). Three modes:

- **`md-opener`** (default) — in the built-in column, with the **Kasimov**
  editor via the shared [packages/md-doc-view](../packages/md-doc-view)
  layer: clickable markdown links with a jump stack in the same column and
  CAS-based saving. The same component used by the
  [MD Opener](../bb-plugin-md-opener) slot. Non-markdown files are edited
  as raw text.
- **`builtin`** — in the built-in column, with the standard `MarkdownEditor`
  from [packages/md-editor](../packages/md-editor), including a
  frontmatter field table.
- **`host`** — delegate to the bb host tab (`experimental_openFilePreview`);
  the file opens with whatever opener bb settings assign to that format.

Synthesized views (a plugin, a connector, a hook command) aren't files —
they always open in the built-in column, and this setting doesn't affect
them. Why this is a choice rather than hardcoded —
[decision](../memory/decisions/claude-config-opener-setting.md), which
supersedes the previous default delegation.

## Connectors and hooks

**Connectors** are Claude Code MCP servers from three sources. Servers from
the project's `.mcp.json` are toggled with a switch (via
`enabledMcpjsonServers` / `disabledMcpjsonServers`, honoring
`enableAllProjectMcpServers`). User- and local-scope servers from
`~/.claude.json` are shown read-only: their enablement isn't gated by
`settings.json`. Clicking a row opens the server definition (JSON).

**Hooks** are the panel's first section, built from the `hooks` key across
all setting levels (event, matcher, command, origin). View-only: Claude
Code has no built-in way to disable a single hook. A row is clickable — it
opens the hook command in the right-hand tab.

## Where it writes

- **Global** — `~/.claude/settings.json`.
- **Project** — `<project path>/.claude/settings.local.json`, not the
  shared `settings.json`: the local file is usually in `.gitignore`, so
  personal toggles don't leak into the repo's team config.

Writes go through `bb.sdk.files` with a hash check: if a parallel Claude
Code session has changed the settings file, the panel reports a conflict
instead of overwriting the other change.

## Development

```sh
npm test        # pure functions in the src/ layer
npm run typecheck
bb plugin install .
bb plugin dev   # rebuild and reload on every save
```

## Layers

- `src/` — pure functions with no I/O, fully covered by tests: parsing and
  editing the settings document, merging levels, parsing the catalog of
  what's installed.
- `server.ts` — the RPC contract and registration with bb.
- `app.tsx` — the panel.
