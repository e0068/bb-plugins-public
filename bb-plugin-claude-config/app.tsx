// bb-plugin-claude-config — panel: area picker up top plus sections (hooks,
// plugins, connectors, skills, agents, tool search). Data and writes go
// through RPC to server.ts; this file only handles display and toggling.
// Skills and agents can be created via a button in the section header
// (name dialog → createSkill/createAgent). .mcp.json connectors
// are toggled by a switch; user/local and hooks are read-only (a hook is
// clickable and opens its contents in the second column).
//
// The SKILL.md of the selected skill (or any open document) is shown in the
// second column inside the panel itself — the DocTab component keyed off the
// same `subPath` route segment (which already carries the area and name) that
// the panel receives. This used to be a fixed tab in the right-hand host panel
// (experimental_fixedTabs), but in bb 0.40.0 navPanel with that option doesn't
// mount and the entry disappears from the sidebar (see task BP-53), so the
// content was moved into the column.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import {
  definePluginApp,
  Markdown,
  useBbNavigate,
  useRpc,
  useSettings,
} from "@get-bb/plugin-sdk/app";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { AreaConfig, rpcContract, WriteOutcome } from "./server";
import { MdDocView } from "./packages/md-doc-view";
import type { LoadedDoc, SaveResult } from "./packages/md-doc-view";
import {
  parseKasimovSettings,
  kasimovCssVars,
  kasimovFlags,
} from "./packages/md-doc-view";
import { isHostOpen, normalizeOpener } from "./src/open-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { isValidName, slugifyName } from "./src/scaffold";
import {
  fieldsFromJson,
  type FrontmatterEntry,
  parseFrontmatter,
  serializeFrontmatter,
  setFieldValue,
} from "./src/frontmatter";
import { MarkdownEditor } from "./packages/md-editor/react";
import { formatWeight } from "./src/weight";
import {
  fileRefFromCode,
  isInTabLink,
  parseHref,
  resolveRelative,
} from "./packages/link-navigation/resolve";
import {
  ResizeHandle,
  HorizontalResizeHandle,
  useResizableWidth,
  useResizableHeight,
} from "./packages/resizable-pane/react";
import { ProjectSwitcher } from "./packages/project-switcher/react";
import { rankCandidates } from "./src/suggest";
import { extractCommandFile } from "./src/hook-script";
import "./doc-editor.css";
// "Workflows" section — a workflow builder embedded in the panel as another
// rail section (see WorkflowsView below). The core (tree model, pure
// operations over it, module-level store) and the builder itself were already
// implemented by neighboring groups; this file only handles integration:
// RPC glue for the wf*-procedures in server.ts and the multi-column layout
// inside the panel.
import { editorStore, engineForStore, type StoreKind, type Identity } from "./src/workflow/store";
import { compile, blankTree, type Engine, type Tree, type Agent, type Phase, type Step } from "./src/workflow/workflow-model";
import { applyTemplate, setAgentField, nodeAt, type OutlinePath } from "./src/workflow/outline-ops";
import { agentsMissingTemplate } from "./src/workflow/validity";
import {
  OutlineEditor,
  AgentDetails,
  type AgentOption,
  type ProviderCatalogEntry,
} from "./components/workflow/outline-editor";

const PANEL_PATH = "claude-config";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

// Middle-column sections — picked from the rail, determine what is shown.
type SectionId =
  | "hooks"
  | "plugins"
  | "connectors"
  | "skills"
  | "agents"
  | "toolSearch"
  | "workflows";

// Enabled-skill mode and write target (including off) — matches the contract.
type SkillMode = "on" | "name-only" | "user-invocable-only";
type SkillTarget = SkillMode | "off";
type ToolSearchModeOn = "on" | "auto";
type ToolSearchTarget = ToolSearchModeOn | "off";

// Enabled-skill modes for the dropdown (ordered from fullest to narrowest).
const SKILL_MODE_OPTIONS: { value: SkillMode; label: string }[] = [
  { value: "on", label: "Full" },
  { value: "name-only", label: "Name only" },
  { value: "user-invocable-only", label: "Slash only" },
];

// Enabled tool-search modes.
const TOOL_SEARCH_MODE_OPTIONS: { value: ToolSearchModeOn; label: string }[] = [
  { value: "auto", label: "Automatic" },
  { value: "on", label: "Always" },
];

// Where the connector is declared — caption under the name.
const CONNECTOR_ORIGIN_LABEL: Record<ConnectorOrigin, string> = {
  mcpjson: ".mcp.json",
  user: "global",
  local: "local",
};

// Which settings level the hook came from.
const HOOK_ORIGIN_LABEL: Record<"user" | "project" | "local", string> = {
  user: "global",
  project: "project",
  local: "local",
};

function connectorSubtitle(origin: ConnectorOrigin, transport: string): string {
  const label = CONNECTOR_ORIGIN_LABEL[origin];
  return transport ? `${label} · ${transport}` : label;
}

// What's open in the right-hand tab lives in subPath. A skill is
// `skill/<area>/<name>` (the server resolves its SKILL.md itself). Any file
// by absolute path (plugin README, memory file) is `doc/<area>/<b64>`, where
// the path is base64url-encoded so its slashes don't collide with the segment
// separator.
type ConnectorOrigin = "mcpjson" | "user" | "local";
type HookOrigin = "user" | "project" | "local";

type DocTarget =
  | { kind: "skill"; areaId: string; name: string }
  | { kind: "plugin"; areaId: string; key: string }
  | { kind: "connector"; areaId: string; name: string; origin: ConnectorOrigin }
  | {
      kind: "hook";
      areaId: string;
      origin: HookOrigin;
      index: number;
      event: string;
    }
  | { kind: "doc"; areaId: string; path: string };

function encodePath(path: string): string {
  return btoa(path).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decodePath(encoded: string): string {
  const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  return atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
}

function skillSubPath(areaId: string, name: string): string {
  return `skill/${areaId}/${name}`;
}
function pluginSubPath(areaId: string, key: string): string {
  return `plugin/${areaId}/${encodePath(key)}`;
}
function connectorSubPath(
  areaId: string,
  origin: ConnectorOrigin,
  name: string,
): string {
  return `connector/${areaId}/${origin}/${encodePath(name)}`;
}
function hookSubPath(
  areaId: string,
  origin: HookOrigin,
  index: number,
  event: string,
): string {
  return `hook/${areaId}/${origin}/${index}/${encodePath(event)}`;
}
function docSubPath(areaId: string, path: string): string {
  return `doc/${areaId}/${encodePath(path)}`;
}
function parseDocSubPath(subPath: string): DocTarget | null {
  const seg = subPath.split("/").filter(Boolean);
  if (seg[0] === "skill" && seg[1] && seg[2]) {
    return { kind: "skill", areaId: seg[1], name: seg[2] };
  }
  if (seg[0] === "plugin" && seg[1] && seg[2]) {
    return { kind: "plugin", areaId: seg[1], key: decodePath(seg[2]) };
  }
  if (seg[0] === "connector" && seg[1] && seg[2] && seg[3]) {
    return {
      kind: "connector",
      areaId: seg[1],
      origin: seg[2] as ConnectorOrigin,
      name: decodePath(seg[3]),
    };
  }
  if (seg[0] === "hook" && seg[1] && seg[2] && seg[3] && seg[4]) {
    return {
      kind: "hook",
      areaId: seg[1],
      origin: seg[2] as HookOrigin,
      index: Number(seg[3]),
      event: decodePath(seg[4]),
    };
  }
  if (seg[0] === "doc" && seg[1] && seg[2]) {
    return { kind: "doc", areaId: seg[1], path: decodePath(seg[2]) };
  }
  return null;
}

// Open a real file per the `fileOpener` setting (memory/decisions/
// claude-config-opener-setting.md). `md-opener`/`builtin` — in the embedded
// column (DocTab by subPath, the editor itself picks the DocTab). `host` —
// delegate to a bb host tab: the server resolves the host for the area and
// path, and it opens the file with the format's opener. Synthesized views
// (plugin, connector, hook command) aren't files and don't go through here.
function useOpenFile(areaId: string): (path: string) => Promise<void> {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const settings = useSettings();
  const fileOpener = (settings.values as { fileOpener?: unknown } | undefined)
    ?.fileOpener;
  return async (path: string) => {
    if (!isHostOpen(fileOpener)) {
      navigate.toPluginPanel(PANEL_PATH, {
        subPath: docSubPath(areaId, path),
      });
      return;
    }
    const { hostId, error } = await rpc.call("resolveOpenTarget", {
      areaId,
      path,
    });
    if (!hostId) {
      toast.error(error ?? "Failed to open the file.");
      return;
    }
    const opened = navigate.experimental_openFilePreview({
      target: { kind: "host", hostId, path },
      location: null,
    });
    if (!opened) toast.error("The host declined to open the file.");
  };
}

// Embedded column in `md-opener` mode: the same MdDocView as the MD Opener
// slot, but layered over this panel's own RPC. Any file (md and non-md) is
// edited as raw text; links resolve the same way as in the rest of the panel
// (relative to the document, `~` and `/` are passed through, the server
// checks the boundaries).
function ColumnMdDocView({
  areaId,
  initialPath,
  leading,
  editButton,
}: {
  areaId: string;
  initialPath: string;
  // Passed through to MdDocView as-is — the tab owner decides what to show at
  // the start of the shared header and what replaces the default "Edit" button
  // (see md-doc-view).
  leading?: ReactNode;
  editButton?: (onClick: () => void) => ReactNode;
}) {
  const rpc = useRpc<typeof rpcContract>();
  // Kasimov look and flags — from the plugin settings (kasimov*). The parser
  // is total: while useSettings is loading (values === undefined) it returns
  // defaults that match kasimov.css.
  const settings = parseKasimovSettings(useSettings().values);
  const vars = kasimovCssVars(settings);
  const flags = kasimovFlags(settings);
  const load = async (path: string): Promise<LoadedDoc> => {
    const res = await rpc.call("readDoc", { areaId, path });
    return {
      path: res.path,
      content: res.content,
      sha256: res.sha256,
      error: res.error,
    };
  };
  const save = (
    path: string,
    content: string,
    expectedSha256: string | null,
  ): Promise<SaveResult> =>
    rpc.call("writeDoc", { areaId, path, content, expectedSha256 });
  const resolveLinkTarget = (href: string, fromPath: string): string | null => {
    if (!isInTabLink(href) && !href.startsWith("~/")) return null;
    const path = parseHref(href).path;
    return path.startsWith("~/") || path.startsWith("/")
      ? path
      : resolveRelative(fromPath, path);
  };
  return (
    <MdDocView
      key={initialPath}
      initialPath={initialPath}
      load={load}
      save={save}
      resolveLinkTarget={resolveLinkTarget}
      vars={vars}
      followLinks={flags.followLinks}
      frontmatter={flags.frontmatter}
      leading={leading}
      editButton={editButton}
    />
  );
}

// Markdown files render as-is; everything else (e.g. plugin.json) renders as
// a code block with extension-based highlighting, so it reads cleanly instead
// of falling apart. Second line of a list item: token weight first, then the
// rest (origin, version, transport). No weight — just the rest; no rest —
// just the weight.
function secondLine(tokens: number | null, rest: string): string {
  const weight = tokens != null ? formatWeight(tokens) : "";
  if (weight && rest) return `${weight} · ${rest}`;
  return weight || rest;
}

function asMarkdown(path: string, content: string): string {
  if (/\.(md|markdown)$/i.test(path)) return content;
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const lang = /^[a-z0-9]+$/.test(ext) ? ext : "";
  return `\`\`\`${lang}\n${content}\n\`\`\``;
}

/**
 * Renders a hook command, turning the file-path token inside it into a
 * clickable link (click — open the file for editing). The token is found by
 * the same parsing used on the server (extractCommandFile), so exactly the
 * path whose contents are shown below gets highlighted. No file or token in
 * the string — the command is rendered as-is.
 */
function renderCommandWithFileLink(
  command: string,
  filePath: string | null,
  onOpen: () => void,
) {
  const token = filePath ? extractCommandFile(command) : null;
  const at = token ? command.indexOf(token) : -1;
  if (!token || at < 0) return command;
  return (
    <>
      {command.slice(0, at)}
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onOpen();
        }}
        title="Open the file for editing"
        className="text-primary hover:underline"
      >
        {token}
      </button>
      {command.slice(at + token.length)}
    </>
  );
}

/**
 * Toggle switch on/off — same size and colors as bb's own native settings
 * switch (see bb-plugin-thread-handoff/components/ui/switch.tsx, the one
 * design-system Switch in this repo): track h-4 w-7, thumb size-3 constant
 * bg-background. bg-primary is achromatic gray in bb's theme (see
 * doc-editor.css) — indistinguishable from bg-muted, hence bg-foreground for
 * the on-track instead.
 *
 * Colors are set imperatively via `style.setProperty(..., "important")`,
 * not Tailwind classes — including the earlier `!bg-foreground`/`!bg-muted`
 * escape hatch (same one used in bb-plugin-token-usage-header). Some host
 * style still won that cascade fight against a class-based `!important` on
 * `[role="switch"]` (on-screen the track read the same gray in both states,
 * which read as "the switch doesn't respond to clicks" — see
 * memory/tasks/in_progress/cloud-config-plugin-kasimov-switch.md). An
 * element's own inline style, written `important`, outranks every
 * author-stylesheet rule regardless of that rule's selector specificity —
 * there's no cascade fight left to lose.
 */
function Switch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  const trackRef = useRef<HTMLButtonElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    trackRef.current?.style.setProperty(
      "background-color",
      checked ? "var(--foreground)" : "var(--muted)",
      "important",
    );
  }, [checked]);
  useEffect(() => {
    thumbRef.current?.style.setProperty(
      "background-color",
      "var(--background)",
      "important",
    );
  }, []);
  return (
    <button
      ref={trackRef}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors"
    >
      <span
        ref={thumbRef}
        className={cn(
          "inline-block size-3 rounded-full shadow transition-transform",
          checked ? "translate-x-3" : "translate-x-0",
        )}
      />
    </button>
  );
}

/** Mode dropdown; disabled (translucent) when the toggle is off. */
function Dropdown<T extends string>({
  value,
  options,
  disabled,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  disabled: boolean;
  onChange: (next: T) => void;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as T)}
      className={cn(
        "h-8 rounded-md border border-border bg-background px-2 text-sm",
        disabled && "opacity-50",
      )}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/**
 * Click-to-edit block for raw text that isn't markdown (JSON, a shell/JS
 * script) — a plain monospace textarea, not MarkdownEditor: WYSIWYG markdown
 * rendering would mangle exact JSON/code text. Mirrors the Save/Cancel
 * affordance of the document toolbar, scoped to just this block.
 *
 * One textarea throughout, `readOnly` until clicked — not a pre/textarea
 * swap — so `rows` (sized to the content once, from `value`) never changes
 * between viewing and editing and the block doesn't jump height on click.
 */
function PlainTextBlock({
  value,
  onSave,
}: {
  value: string;
  onSave: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const rows = Math.min(20, Math.max(3, value.split("\n").length));

  return (
    <div className="flex flex-col gap-1">
      <textarea
        readOnly={!editing}
        rows={rows}
        value={editing ? draft : value}
        onClick={() => {
          if (editing) return;
          setDraft(value);
          setEditing(true);
        }}
        onChange={(event) => editing && setDraft(event.target.value)}
        className={cn(
          "w-full rounded-md border border-border p-2 font-mono text-sm",
          editing ? "cursor-text bg-background" : "cursor-pointer bg-muted/30",
        )}
      />
      {editing && (
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => {
              onSave(draft);
              setEditing(false);
            }}
            className="rounded-md px-2 py-1 text-sm text-primary hover:bg-muted"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Dialog for creating a skill or agent: a single name field. The name is
 * normalized into a slug (latin letters, digits, hyphens) — if it differs, we
 * show which slug the file will be created with. `onCreate` returns an error
 * message or null on success.
 */
function CreateDialog({
  open,
  title,
  description,
  onClose,
  onCreate,
}: {
  open: boolean;
  title: string;
  description: string;
  onClose: () => void;
  onCreate: (name: string) => Promise<string | null>;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The dialog resets on every open.
  useEffect(() => {
    if (open) {
      setName("");
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const slug = slugifyName(name);
  const canSubmit = isValidName(name) && !busy;

  const submit = () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    void onCreate(name).then((message) => {
      setBusy(false);
      if (message) setError(message);
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Input
            autoFocus
            value={name}
            placeholder="name-with-hyphens"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && submit()}
          />
          {name.trim() !== "" && slug !== name.trim() && (
            <p className="text-xs text-muted-foreground">
              Will be created as: {slug || "—"}
            </p>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Right-hand tab: shows the document selected via `subPath` — a skill's
 * SKILL.md or a file by absolute path (plugin README, memory) — rendered with
 * the host Markdown component. File links inside the document (both `<a>`
 * tags and backtick code spans like `references/x.md`) open in this same tab
 * through a single `readDoc`; the stack holds absolute paths for "back".
 */
type Loaded = {
  path: string;
  content: string | null;
  error: string | null;
  sha256: string | null;
};

// The file's frontmatter — a "field → value" table spanning the page width.
// The key is pinned left and doesn't stretch, the value takes the rest.
// readOnly — for plugins (the manifest isn't edited through this path);
// otherwise values are editable. Only top-level fields go into the table;
// nested/raw block lines are preserved on write but not shown.
function FrontmatterTable({
  entries,
  onChange,
  readOnly = false,
}: {
  entries: FrontmatterEntry[];
  onChange?: (index: number, value: string) => void;
  readOnly?: boolean;
}) {
  // Only top-level fields; keep the original index for onChange.
  const fields: { key: string; value: string; index: number }[] = [];
  entries.forEach((entry, index) => {
    if (entry.kind === "field") {
      fields.push({ key: entry.key, value: entry.value, index });
    }
  });

  return (
    // The block is width-limited and centered. The rounded, overflow-hidden
    // wrapper clips the fill's corners; the grid is drawn by cell borders, not
    // the table's own border (otherwise border-collapse breaks the rounding).
    <div className="p-4">
      <div
        style={{ width: 668 }}
        className="mx-auto overflow-hidden rounded-lg border border-border"
      >
        <table className="w-full border-collapse text-sm">
          <tbody>
            {fields.map((field, pos) => {
              const notLast = pos < fields.length - 1;
              return (
                <tr key={field.index}>
                  <td
                    className={cn(
                      "w-px whitespace-nowrap border-r border-border bg-muted/50 px-3 py-2 align-top font-mono text-xs text-muted-foreground",
                      notLast && "border-b border-border",
                    )}
                  >
                    {field.key}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2 align-top",
                      notLast && "border-b border-border",
                    )}
                  >
                    {readOnly ? (
                      <div className="whitespace-pre-wrap break-words">
                        {field.value}
                      </div>
                    ) : (
                      <textarea
                        rows={1}
                        value={field.value}
                        onChange={(event) =>
                          onChange?.(field.index, event.target.value)
                        }
                        className="cc-fm-value"
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DocTab({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const opener = normalizeOpener(
    (useSettings().values as { fileOpener?: unknown } | undefined)?.fileOpener,
  );
  const target = parseDocSubPath(subPath);
  const areaId = target?.areaId ?? "";
  // A real file in `md-opener` mode is rendered by MdDocView (which also
  // loads and edits it). The composite/hook branches and `builtin` mode
  // follow the old path below.
  const mdOpenerDoc = target?.kind === "doc" && opener === "md-opener";

  // Stack of visited absolute paths (last one is current) and the loaded file.
  const [stack, setStack] = useState<string[]>([]);
  const [doc, setDoc] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  // Edit mode: the same MarkdownEditor, but editable; entered by clicking the text.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saveNote, setSaveNote] = useState<string | null>(null);
  // Composite (plugin: manifest + README) — already-assembled markdown, not editable.
  const [composite, setComposite] = useState(false);
  // Paths within the document folder's subtree — for / (path) suggestions.
  // The editor calls pathProvider synchronously, so we keep the list in memory.
  const [docPaths, setDocPaths] = useState<string[]>([]);
  // Targets for @ (import) suggestions: skills and area memory files — a
  // separate source, not a subset of docPaths, so @code-st matches by label
  // ("code-standards") rather than by files in the current document's subtree.
  const [refTargets, setRefTargets] = useState<
    { value: string; label: string }[]
  >([]);
  // Extra hook data: its definition (JSON) and the contents of the file the
  // command reads or runs (if recognized) — both editable in place (see
  // saveHookDefinition/saveHookFile), each with its own CAS sha256.
  const [hookExtra, setHookExtra] = useState<{
    definition: string | null;
    filePath: string | null;
    fileContent: string | null;
    fileSha256: string | null;
  } | null>(null);
  // Parsing the current document's frontmatter: fields go into the table, the
  // body goes into the editor. hasFm=false → the file has no frontmatter, the
  // body equals the whole content.
  const [hasFm, setHasFm] = useState(false);
  const [fmEntries, setFmEntries] = useState<FrontmatterEntry[]>([]);
  const [fmBody, setFmBody] = useState("");
  // Plugin manifest (JSON) — its "frontmatter", shown as a table above the README.
  const [pluginManifest, setPluginManifest] = useState<string | null>(null);

  // Assemble the file's content from the fields and body: with frontmatter —
  // serialize the block, without it — the body is the whole file.
  const composeContent = (entries: FrontmatterEntry[], body: string) =>
    hasFm ? serializeFrontmatter(entries, body) : body;

  // Split the document into frontmatter and body. Composite (plugin/connector)
  // and hook have their own representation — leave them alone, body = the
  // whole content.
  const splitDoc = (loaded: Loaded | null, isComposite: boolean) => {
    if (!loaded || loaded.content == null || isComposite) {
      setHasFm(false);
      setFmEntries([]);
      setFmBody(loaded?.content ?? "");
      return;
    }
    const parsed = parseFrontmatter(loaded.content);
    setHasFm(parsed.hasFrontmatter);
    setFmEntries(parsed.entries);
    setFmBody(parsed.body);
  };

  // Showing any new file exits edit mode.
  const present = (result: Loaded) => {
    setDoc(result);
    setEditing(false);
    setSaveNote(null);
    setLoading(false);
    // Extra hook data is only set by the hook branch; reset it for other documents.
    setHookExtra(null);
    // The manifest is only set by the plugin branch; reset it for other documents.
    setPluginManifest(null);
    // Prefetch paths for / suggestions (silently; errors don't block display).
    if (result.path && result.content != null) {
      void rpc
        .call("listDocPaths", { areaId, path: result.path })
        .then((r) => setDocPaths(r.paths))
        .catch(() => setDocPaths([]));
    } else {
      setDocPaths([]);
    }
    // Prefetch targets for @ suggestions — independent of the current file,
    // only depends on the area.
    if (areaId) {
      void rpc
        .call("listRefTargets", { areaId })
        .then((r) =>
          setRefTargets(
            r.targets.map((t) => ({ value: t.value, label: t.label })),
          ),
        )
        .catch(() => setRefTargets([]));
    } else {
      setRefTargets([]);
    }
  };

  // Recompute frontmatter/body when the document or its type changes. Reads
  // the committed doc/composite (not from the present() closure), so it stays
  // correct both after a save (doc.content updated) and when switching files.
  useEffect(() => {
    splitDoc(doc, composite);
    // splitDoc depends only on doc and composite.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, composite]);

  // First render by subPath: the server resolves a skill (readSkillFile), a
  // plugin — manifest + README (readPlugin, composite), any file — by absolute
  // path (readDoc). We push the absolute path onto the stack — "back" and
  // links use it.
  useEffect(() => {
    if (!target) {
      setDoc(null);
      setStack([]);
      setEditing(false);
      setComposite(false);
      return;
    }
    // md-opener mode for a file: DocTab doesn't load it — MdDocView reads and edits it itself.
    if (mdOpenerDoc) {
      setLoading(false);
      return;
    }
    let ok = true;
    setLoading(true);
    setDoc(null);

    if (target.kind === "plugin") {
      void rpc
        .call("readPlugin", { areaId: target.areaId, key: target.key })
        .then((result) => {
          if (!ok) return;
          // README links are resolved relative to the plugin folder (the README's folder).
          const base = result.readmePath ?? result.manifestPath;
          setStack(base ? [base] : []);
          if (result.error && result.manifest == null) {
            setComposite(false);
            present({
              path: result.manifestPath,
              content: null,
              error: result.error,
              sha256: null,
            });
            return;
          }
          // The manifest goes into the "frontmatter" table (pluginManifest),
          // the body is the README as-is. present() resets pluginManifest, so
          // we set it after calling present.
          setComposite(true);
          present({
            path: result.manifestPath,
            content: result.readme ?? "",
            error: null,
            sha256: null,
          });
          setPluginManifest(result.manifest);
        });
      return () => {
        ok = false;
      };
    }

    if (target.kind === "connector") {
      void rpc
        .call("readConnector", {
          areaId: target.areaId,
          name: target.name,
          origin: target.origin,
        })
        .then((result) => {
          if (!ok) return;
          setStack(result.path ? [result.path] : []);
          if (result.error || result.content == null) {
            setComposite(false);
            present({
              path: result.path,
              content: null,
              error: result.error,
              sha256: null,
            });
            return;
          }
          // The definition is a slice of a larger file, shown as a JSON block, not editable.
          setComposite(true);
          present({
            path: result.path,
            content: "```json\n" + result.content + "\n```",
            error: null,
            sha256: null,
          });
        });
      return () => {
        ok = false;
      };
    }

    if (target.kind === "hook") {
      void rpc
        .call("readHook", {
          areaId: target.areaId,
          origin: target.origin,
          index: target.index,
        })
        .then((result) => {
          if (!ok) return;
          setStack(result.path ? [result.path] : []);
          // A raw command (bash), not markdown assembly — edited with the same
          // MarkdownEditor as a regular document (see writeHook in save()).
          setComposite(false);
          present({
            path: result.path,
            content: result.command,
            error: result.error,
            sha256: result.sha256,
          });
          setHookExtra({
            definition: result.definition,
            filePath: result.filePath,
            fileContent: result.fileContent,
            fileSha256: result.fileSha256,
          });
        });
      return () => {
        ok = false;
      };
    }

    setComposite(false);
    const request =
      target.kind === "skill"
        ? rpc.call("readSkillFile", {
            areaId: target.areaId,
            name: target.name,
            relPath: "SKILL.md",
          })
        : rpc.call("readDoc", { areaId: target.areaId, path: target.path });
    void request.then((result) => {
      if (!ok) return;
      setStack(result.path ? [result.path] : []);
      present(result);
    });
    return () => {
      ok = false;
    };
    // target is derived from subPath.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subPath, rpc, mdOpenerDoc]);

  // A file link inside the shown document (plugin README, editor link) is a
  // real file: open it with bb's native opener rather than loading it into
  // the embedded column.
  const openFile = useOpenFile(areaId);
  const openAbs = (abs: string) => void openFile(abs);

  // Click on a file link inside a composite (plugin/connector/hook) document:
  // it's rendered by the host `Markdown` component, not MarkdownEditor, since
  // it's an assembled view — not a standalone markdown file. We catch `<a>`
  // and inline code like `references/x.md`. The target is resolved relative
  // to the current file.
  const onCompositeClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const current = stack[stack.length - 1];
    if (!current) return;
    const element = event.target as HTMLElement;
    const anchor = element.closest("a");
    const code = element.closest("code");
    let ref: string | null = null;
    if (anchor) {
      const href = anchor.getAttribute("href") ?? "";
      if (isInTabLink(href)) ref = href;
    } else if (code) {
      ref = fileRefFromCode(code.textContent ?? "");
    }
    if (!ref) return;
    event.preventDefault();
    openAbs(resolveRelative(current, ref));
  };

  // linkResolver for MarkdownEditor: `[..](..)` links and `@` imports
  // (atLinks) resolve relative to the current document's path and open in
  // this same tab. `~/` and absolute `/` are passed through as-is — the server
  // expands `~` and checks the boundaries; a relative path is resolved from
  // the document's folder.
  const fromPath = doc?.path ?? stack[stack.length - 1] ?? "";
  const linkResolver = (href: string) => {
    if (!isInTabLink(href) && !href.startsWith("~/")) return null;
    const path = parseHref(href).path;
    const abs =
      path.startsWith("~/") || path.startsWith("/")
        ? path
        : resolveRelative(fromPath, path);
    return { onClick: () => openAbs(abs) };
  };

  // Editor suggestions: @ (import) — everything referenceable at once (skills,
  // memory, AND subtree files), because only an @-import yields a valid link
  // in the document; skills/memory match by their human-readable label
  // (@code-st → code-standards). / (path) — bare subtree file paths, for when
  // a path is typed without @. The editor calls pathProvider synchronously on
  // every keystroke, so we keep the lists pre-assembled in memory (docPaths,
  // refTargets).
  const pathProvider = (query: string, mode: "path" | "import") => {
    if (mode === "import") {
      const candidates = [
        ...refTargets,
        ...docPaths.map((p) => ({ value: p, label: p })),
      ];
      return rankCandidates(candidates, query, 8).map((c) => ({
        path: c.value,
        label: c.label ?? c.value,
      }));
    }
    return rankCandidates(
      docPaths.map((p) => ({ value: p })),
      query,
      8,
    ).map((c) => ({ path: c.value, label: c.value }));
  };

  const back = () => {
    if (stack.length < 2) return;
    const prev = stack[stack.length - 2];
    setStack((s) => s.slice(0, -1));
    setLoading(true);
    setComposite(false);
    void rpc.call("readDoc", { areaId, path: prev }).then(present);
  };

  const startEdit = () => {
    setDraft(doc?.content ?? "");
    setSaveNote(null);
    setEditing(true);
  };

  // Save with CAS: sha from the last read. Conflict — show a message, don't
  // lose the edit; success — update the content and the fresh sha, exit edit
  // mode. Takes the content as a parameter (doesn't read `draft` from the
  // closure) — so the editor's onSave (⌘S) can pass its fresh value
  // synchronously, without waiting for setDraft to apply.
  const save = (content: string) => {
    if (!doc || !target) return;
    setSaveNote(null);
    // A hook is written via its own RPC (index addressing within the level's
    // file), everything else via a regular write by path.
    const request =
      target.kind === "hook"
        ? rpc.call("writeHook", {
            areaId,
            origin: target.origin,
            index: target.index,
            command: content,
            expectedSha256: doc.sha256,
          })
        : rpc.call("writeDoc", {
            areaId,
            path: doc.path,
            content,
            expectedSha256: doc.sha256,
          });
    void request.then((result) => {
      if (result.outcome === "written") {
        setDoc({
          path: doc.path,
          content,
          error: null,
          sha256: result.sha256,
        });
        setEditing(false);
      } else {
        setSaveNote(result.message ?? "Failed to save.");
      }
    });
  };

  // Definition edit can move the hook to a different event or matcher group
  // (see sd.replaceHook) — that shifts its flat index within the level's
  // file, so `target.index` (baked into the current subPath) may no longer
  // point at this hook. Rather than guess the new index, land back on the
  // Hooks list on success; the edited hook shows up there, in its new spot.
  const saveHookDefinition = (definition: string) => {
    if (!target || target.kind !== "hook") return;
    void rpc
      .call("writeHookDefinition", {
        areaId,
        origin: target.origin,
        index: target.index,
        definition,
        expectedSha256: doc?.sha256 ?? null,
      })
      .then((result) => {
        if (result.outcome === "written") {
          toast.success("Hook saved.");
          navigate.toPluginPanel(PANEL_PATH, { subPath: "", replace: true });
        } else {
          toast.error(result.message ?? "Failed to save.");
        }
      });
  };

  // The referenced script (json/mjs/sh) is a real file — the same writeDoc
  // RPC as any other document, with its own CAS sha256 (hookExtra.fileSha256,
  // separate from the hook command's doc.sha256).
  const saveHookFile = (content: string) => {
    if (!hookExtra?.filePath) return;
    const filePath = hookExtra.filePath;
    void rpc
      .call("writeDoc", {
        areaId,
        path: filePath,
        content,
        expectedSha256: hookExtra.fileSha256,
      })
      .then((result) => {
        if (result.outcome === "written") {
          setHookExtra({
            ...hookExtra,
            fileContent: content,
            fileSha256: result.sha256,
          });
          toast.success("File saved.");
        } else {
          toast.error(result.message ?? "Failed to save.");
        }
      });
  };

  if (!target) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Select a skill, plugin, or memory file on the left to see its contents.
      </div>
    );
  }

  // md-opener mode: the column hands the whole file over to MdDocView (its own
  // header, jump stack, CAS). No DocTab breadcrumbs or field table — a plain
  // MD Opener.
  if (mdOpenerDoc && target.kind === "doc") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <ColumnMdDocView areaId={target.areaId} initialPath={target.path} />
      </div>
    );
  }

  const heading =
    target.kind === "skill" || target.kind === "connector"
      ? target.name
      : target.kind === "hook"
        ? target.event
        : target.kind === "plugin"
          ? target.key.split("@")[0]
          : (doc?.path?.split("/").pop() ?? "");
  // Composite (plugin) is not editable — it's an assembly of two files.
  const canEdit = !!doc && doc.content != null && !doc.error && !composite;

  // Clicking text in view mode enters edit mode. Links are handled by the
  // editor itself via linkResolver, inline code like `references/x.md` — a
  // navigation; everything else — startEdit. In edit mode, clicks are handled
  // by the editor.
  const onDocClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (editing) return;
    const el = event.target as HTMLElement;
    if (el.closest(".mde-link")) return;
    const code = el.closest("code");
    if (code) {
      const current = stack[stack.length - 1];
      const ref = current ? fileRefFromCode(code.textContent ?? "") : null;
      if (ref) {
        event.preventDefault();
        openAbs(resolveRelative(current as string, ref));
        return;
      }
    }
    if (canEdit) startEdit();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start gap-2 border-b border-border p-3">
        {!editing && stack.length > 1 && (
          <button
            type="button"
            onClick={back}
            className="shrink-0 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted"
            aria-label="Back"
          >
            ←
          </button>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{heading}</div>
          {/* The plugin's marketplace lives in the key (name@marketplace) — we
              show it by the body's header, not as a second line in the list. */}
          {target.kind === "plugin" && target.key.includes("@") && (
            <div className="truncate text-xs text-muted-foreground">
              {target.key.slice(target.key.indexOf("@") + 1)}
            </div>
          )}
          {doc?.path && (
            <div className="truncate text-xs text-muted-foreground">
              {doc.path}
            </div>
          )}
          {saveNote && (
            <div className="text-xs text-destructive">{saveNote}</div>
          )}
        </div>
        {editing && (
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={() => save(draft)}
              className="rounded-md px-2 py-1 text-sm text-primary hover:bg-muted"
              aria-label="Save"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setSaveNote(null);
                // Roll back unsaved frontmatter and body edits to match the file.
                splitDoc(doc, composite);
              }}
              className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted"
              aria-label="Cancel"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && (
          <p className="p-4 text-sm text-muted-foreground">Loading…</p>
        )}
        {!loading && doc?.error && (
          <p className="p-4 text-sm text-destructive">{doc.error}</p>
        )}
        {/* Plugin: manifest as a full-width table, README below — the README
            is a real markdown file, so it opens through the same Kasimov
            engine (MarkdownEditor) as skills and docs, not the plain host
            Markdown renderer. Read-only: the manifest isn't edited through
            this path (memory/decisions/kasimov-settings-first-in-cloud-config.md). */}
        {!loading && doc?.content != null && composite && target.kind === "plugin" && (
          <div className="flex h-full flex-col">
            {pluginManifest && (
              <FrontmatterTable
                entries={fieldsFromJson(pluginManifest)}
                readOnly
              />
            )}
            {doc.content && (
              <div className="min-h-0 flex-1 p-4">
                <MarkdownEditor
                  editable={false}
                  atLinks
                  value={doc.content}
                  linkResolver={linkResolver}
                  pathProvider={pathProvider}
                  className="h-full cc-doc-mde"
                />
              </div>
            )}
          </div>
        )}
        {/* Connector: the definition is a JSON slice, not a standalone
            document — the plain host Markdown renderer fits a fenced code
            block just as well and keeps the composite-link click handling. */}
        {!loading && doc?.content != null && composite && target.kind !== "plugin" && (
          <div onClick={onCompositeClick}>
            {doc.content && (
              <div className="p-4">
                <Markdown content={doc.content} />
              </div>
            )}
          </div>
        )}
        {!loading && doc?.content != null && !composite && target.kind === "hook" && (
          <div className="flex flex-col gap-4 p-4">
            {hookExtra?.definition && (
              <section>
                <div className="mb-1 text-xs font-medium text-muted-foreground">
                  Definition (click to edit)
                </div>
                <PlainTextBlock
                  value={hookExtra.definition}
                  onSave={saveHookDefinition}
                />
              </section>
            )}
            <section>
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                Command {editing ? "" : "(click to edit)"}
              </div>
              {editing ? (
                <div onClick={onDocClick}>
                  <MarkdownEditor
                    editable
                    value={draft}
                    onChange={setDraft}
                    onSave={(md) => {
                      setDraft(md);
                      save(md);
                    }}
                    className="cc-doc-mde"
                  />
                </div>
              ) : (
                <div
                  onClick={onDocClick}
                  className="cursor-text whitespace-pre-wrap break-all rounded-md border border-border bg-muted/30 p-2 font-mono text-sm"
                >
                  {renderCommandWithFileLink(
                    doc.content,
                    hookExtra?.filePath ?? null,
                    () =>
                      hookExtra?.filePath &&
                      navigate.toPluginPanel(PANEL_PATH, {
                        subPath: docSubPath(areaId, hookExtra.filePath),
                      }),
                  )}
                </div>
              )}
            </section>
            {hookExtra?.fileContent != null && (
              <section>
                <div className="mb-1 break-all font-mono text-xs font-medium text-muted-foreground">
                  {hookExtra.filePath} (click to edit)
                </div>
                <PlainTextBlock
                  value={hookExtra.fileContent}
                  onSave={saveHookFile}
                />
              </section>
            )}
          </div>
        )}
        {!loading && doc?.content != null && !composite && target.kind !== "hook" && (
          <div className="flex h-full flex-col">
            {hasFm && fmEntries.some((entry) => entry.kind === "field") && (
              <FrontmatterTable
                entries={fmEntries}
                onChange={(index, value) => {
                  const next = setFieldValue(fmEntries, index, value);
                  setFmEntries(next);
                  setEditing(true);
                  setDraft(composeContent(next, fmBody));
                }}
              />
            )}
            <div className="min-h-0 flex-1 p-4" onClick={onDocClick}>
              <MarkdownEditor
                editable={editing}
                atLinks
                value={editing ? fmBody : asMarkdown(doc.path, fmBody)}
                onChange={(md) => {
                  setFmBody(md);
                  setDraft(composeContent(fmEntries, md));
                }}
                linkResolver={linkResolver}
                pathProvider={pathProvider}
                onSave={(md) => {
                  const content = composeContent(fmEntries, md);
                  setDraft(content);
                  save(content);
                }}
                className="h-full cc-doc-mde"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- "Workflows" section (ported from bb-plugin-workflow-composer, without the code column) ----

// The editor tree lives in the module-level editorStore (see
// ./src/workflow/store) — shared between the builder and the code preview
// across several host mount points; here we read it the same way.
const useEditor = () =>
  useSyncExternalStore(editorStore.subscribe, editorStore.getSnapshot, editorStore.getSnapshot);

interface WfItem {
  name: string;
  path: string;
  store: StoreKind;
  description: string;
  hasTree: boolean;
}
const AGENT_SCOPE_LABEL: Record<"user" | "project" | "plugin", string> = {
  user: "personal",
  project: "project",
  plugin: "plugin",
};

function useWfAgents(rpc: Rpc, projectId: string | null): AgentOption[] {
  const [agents, setAgents] = useState<AgentOption[]>([]);
  useEffect(() => {
    void rpc.call("wfAgents", { projectId }).then((r) => setAgents(r.agents));
  }, [rpc, projectId]);
  return agents;
}

// Workflow count for the rail ("Workflows" section). Updates on area change,
// like the other counters; null — not loaded yet.
function useWfCount(rpc: Rpc, areaId: string): number | null {
  const [count, setCount] = useState<number | null>(null);
  const projectId = areaId === "global" ? null : areaId;
  useEffect(() => {
    let alive = true;
    void rpc.call("wfList", { projectId }).then((r) => {
      if (alive) setCount((r.items as WfItem[]).length);
    });
    return () => {
      alive = false;
    };
  }, [rpc, projectId]);
  return count;
}

function useWfProviderCatalog(rpc: Rpc): ProviderCatalogEntry[] {
  const [catalog, setCatalog] = useState<ProviderCatalogEntry[]>([]);
  useEffect(() => {
    void rpc.call("wfProviderCatalog", null).then((r) => setCatalog(r));
  }, [rpc]);
  return catalog;
}

// Polling the run status: `wfStatus` is a free read operation, we show the CLI text as-is.
function pollStatus(rpc: Rpc, runId: string, setOutput: (s: string) => void): void {
  let ticks = 0;
  const timer = setInterval(() => {
    ticks += 1;
    void rpc.call("wfStatus", { runId }).then((r) => setOutput(r.output));
    if (ticks >= 15) clearInterval(timer);
  }, 2000);
}

// A hand-written .js file without a builder mirror tree — we show the source
// as-is, read-only: saving over it would compile a stub tree and wipe out the
// real code.
function CodeOnlyView({ source }: { source: string }) {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
        Hand-written — no builder tree. Read-only; edit the .js file directly.
      </div>
      <pre className="flex-1 overflow-auto p-4 font-mono text-xs text-foreground" aria-label="workflow source">
        {source}
      </pre>
    </div>
  );
}

function WfList({
  items,
  onOpen,
  activePath,
}: {
  items: WfItem[];
  onOpen: (i: WfItem) => void;
  activePath?: string;
}) {
  return (
    <div className="space-y-1">
      {items.length === 0 && <div className="px-1 py-0.5 text-xs text-muted-foreground">empty</div>}
      {items.map((item) => (
        <button
          key={item.path}
          type="button"
          onClick={() => onOpen(item)}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
            activePath === item.path && "bg-accent",
          )}
          title={item.description || item.name}
        >
          <span className="min-w-0 flex-1 truncate">{item.name}</span>
          {!item.hasTree && (
            <span className="shrink-0 text-xs text-muted-foreground" title="File without a builder tree — opens as code">
              code only
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// Save dialog: name + storage (project → .bb/workflows, bb engine; global →
// ~/.claude/workflows, Claude Code engine). The engine is derived from the
// storage (engineForStore) — they're always paired.
function WfSaveDialog({
  open,
  onOpenChange,
  rpc,
  projectId,
  tree,
  defaultName,
  defaultStore,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rpc: Rpc;
  projectId: string | null;
  tree: Tree;
  defaultName: string;
  defaultStore: StoreKind;
  onSaved: (identity: Identity) => void;
}) {
  const [name, setName] = useState(defaultName);
  const [store, setStore] = useState<StoreKind>(defaultStore);
  useEffect(() => {
    if (open) {
      setName(defaultName);
      setStore(defaultStore);
    }
  }, [open, defaultName, defaultStore]);

  const engine: Engine = engineForStore(store);

  const save = async () => {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name.trim())) {
      toast.error("Name must be lowercase latin letters, digits, and hyphens, no spaces (e.g. review-changes)");
      return;
    }
    // The bb engine requires a non-empty description — checked here so saving can't produce an invalid file.
    if (engine === "bb" && !tree.description.trim()) {
      toast.error("Add a description to save to the project — the bb engine requires it");
      return;
    }
    try {
      const res = await rpc.call("wfSave", { projectId, store, name: name.trim(), source: compile(tree, engine) });
      toast.success(store === "project" ? "Saved to the project" : "Saved globally");
      onOpenChange(false);
      onSaved({ store, path: res.path, name: name.trim() });
    } catch (e) {
      toast.error("Failed to save: " + String((e as Error).message ?? e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Save workflow</DialogTitle>
          <DialogDescription>Where to save it and under what name.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block space-y-1.5">
            <span className="text-xs text-muted-foreground">Where</span>
            <select
              aria-label="save destination"
              value={store}
              onChange={(e) => setStore(e.target.value as StoreKind)}
              className="flex h-9 w-full items-center rounded-md border border-border bg-transparent px-3 text-sm text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="project" disabled={!projectId}>
                Project · .bb/workflows · bb engine{!projectId ? " — no project" : ""}
              </option>
              <option value="global">Global · ~/.claude/workflows · Claude Code</option>
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs text-muted-foreground">Name (kebab-case)</span>
            <Input
              aria-label="save name"
              placeholder="review-changes"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} aria-label="confirm save">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Body of the "Workflows" section: list (col. 2) + the builder itself (col.
// 3) + when an agent step is selected — a combined column 4 (list of
// available agent types, or, after selection, the agent detail). Columns 2–3
// resize independently, each with its own localStorage key — the same way the
// rail and section list do in ConfigPanel; column 4 doesn't resize, it takes
// up the rest of the page width.
function WorkflowsView({ rpc, areaId }: { rpc: Rpc; areaId: string }) {
  const { tree, identity, rawSource } = useEditor();
  const codeOnly = rawSource != null;

  // Workflow project — the same axis as "Area" in the Cloud Config header: the
  // sentinel "global" means the global area, any other areaId value is a
  // bb project id.
  const projectId = areaId === "global" ? null : areaId;
  const [items, setItems] = useState<WfItem[]>([]);
  const [output, setOutput] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [selectedPath, setSelectedPath] = useState<OutlinePath | null>(null);
  // Combined column 4 (agents + detail): the agent list or the detail of an
  // already-selected one (file + settings). Toggled by clicking an agent /
  // the "Back" button.
  const [pickerOpen, setPickerOpen] = useState(true);

  const agents = useWfAgents(rpc, projectId);
  const providerCatalog = useWfProviderCatalog(rpc);

  // Area change — the stale selected step (col. 4) belongs to the previous tree/project.
  useEffect(() => {
    setSelectedPath(null);
  }, [projectId]);

  const refresh = () => {
    void rpc.call("wfList", { projectId }).then((r) => setItems(r.items as WfItem[]));
  };
  // rpc — a stable reference for the panel's lifetime, refresh — a new
  // function on every render; the dependency list only needs what actually
  // changes the list.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, [projectId]);

  const openItem = async (item: WfItem) => {
    const res = await rpc.call("wfRead", { projectId: projectId, store: item.store, path: item.path });
    const parsedTree = res.tree as Tree | null;
    // No builder tree → a hand-written file: open it as-is, read-only.
    editorStore.load(
      parsedTree ?? blankTree(item.name),
      { store: item.store, path: item.path, name: item.name },
      parsedTree ? null : res.source,
    );
    setSelectedPath(null);
  };

  // `bb workflows` only works with project (bb) workflows. Global ones
  // (~/.claude) are Claude Code — validate/run aren't available for them from
  // this panel.
  const bbRunnable = identity?.store === "project";

  const doValidate = async () => {
    if (!identity) {
      toast.error("Save the workflow first — validation reads the file on disk");
      return;
    }
    if (!bbRunnable) {
      toast.error("Validation is only available for project workflows; global ones run through Claude Code");
      return;
    }
    const res = await rpc.call("wfValidate", { projectId: projectId, store: identity.store, path: identity.path });
    setOutput(res.output || (res.ok ? "No errors" : "Has errors"));
    if (res.ok) toast.success("Validation passed");
    else toast.error("Validation found errors — see the output below");
  };

  const doRun = async () => {
    if (!identity) {
      toast.error("Save the workflow first — running executes the file on disk");
      return;
    }
    if (!bbRunnable) {
      toast.error("Running is only available for project workflows; global ones run through Claude Code");
      return;
    }
    const res = await rpc.call("wfRun", { projectId: projectId, store: identity.store, path: identity.path });
    setOutput(res.output);
    if (res.runId) {
      toast.success("Started");
      pollStatus(rpc, res.runId, setOutput);
    } else {
      toast.error("Failed to run — see the output below");
    }
  };

  const doDelete = async () => {
    if (!identity) return;
    await rpc.call("wfRemove", { projectId: projectId, store: identity.store, path: identity.path });
    toast.success("Workflow deleted");
    editorStore.newWorkflow();
    setSelectedPath(null);
    refresh();
  };

  // Selected agent step (for the combined column 4): the node at selectedPath, if it's an agent rather than a phase/group.
  const node: Phase | Step | null = selectedPath ? nodeAt(tree, selectedPath) : null;
  const selAgent: Agent | null = node && "type" in node && node.type === "agent" ? node : null;
  // The file for the selected agent template — shown by the upper half of the
  // detail in Kasimov rendering (the same MdDocView as the MD Opener slot). No
  // template or path — no upper half.
  const selAgentPath: string | null = selAgent ? agents.find((a) => a.value === selAgent.agentType)?.path ?? null : null;

  // A newly selected step: the detail opens right away if a template is
  // already assigned to it, otherwise — the picker list. From there, toggling
  // happens by clicking an agent in the list or the "Back" button, so the
  // dependency list only has selectedPath — editing selAgent.agentType
  // (choosing a template) must not roll pickerOpen back.
  useEffect(() => {
    setPickerOpen(!selAgent || selAgent.agentType.trim() === "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPath]);

  const { width: listWidth, startResize: startListResize } = useResizableWidth({
    initial: 240,
    min: 200,
    max: 400,
    side: "left",
    storageKey: "claude-config:wf-list-width",
  });
  const { width: constructorWidth, startResize: startConstructorResize } = useResizableWidth({
    initial: 360,
    min: 220,
    max: 760,
    side: "left",
    // Key with a -v2 suffix: the previous version had already written 540 to
    // localStorage on mount (useResizableWidth writes the width on mount too),
    // which caused the new initial value to be ignored. The new key gives a
    // fresh start at 360, resizable down to 220.
    storageKey: "claude-config:wf-constructor-width-v2",
  });
  // The combined column 4 has no resizable width of its own — it takes up all
  // the remaining page width (flex-1); only constructorWidth (the handle
  // between the builder and this column) governs the reserved width of the
  // list column.
  // Height of the detail column's upper half — the agent file in Kasimov; the handle is at the bottom, drag down for more height.
  const { height: agentFileHeight, startResize: startAgentFileResize } = useResizableHeight({
    initial: 280,
    min: 120,
    max: 640,
    storageKey: "claude-config:wf-agent-file-height",
  });

  // Builder validity: an agent is valid only with a template selected. As
  // long as at least one agent has no template chosen — the workflow is
  // invalid and saving is blocked.
  const invalidAgents = agentsMissingTemplate(tree);

  return (
    // min-w-0 flex-1 — this root itself sits as a flex item in ConfigPanel's
    // row (next to the section rail); without them it wouldn't stretch to the
    // full page width and would shrink to fit its content — which meant the
    // combined column 4 below couldn't reach the right edge.
    <div className="flex h-full min-h-0 min-w-0 flex-1 overflow-x-auto">
      <div style={{ width: listWidth }} className="flex h-full shrink-0 flex-col overflow-hidden border-r border-border">
        <div className="flex flex-col gap-2 border-b border-border p-2">
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" onClick={() => setSaveOpen(true)} disabled={codeOnly || invalidAgents > 0}>
              Save
            </Button>
            <Button size="sm" variant="outline" onClick={doValidate} disabled={!bbRunnable}>
              Validate
            </Button>
            <Button size="sm" variant="outline" onClick={doRun} disabled={!bbRunnable}>
              Run
            </Button>
            <Button size="sm" variant="outline" onClick={doDelete} disabled={!identity}>
              Delete
            </Button>
          </div>
          {!codeOnly && invalidAgents > 0 && (
            <p className="text-xs text-muted-foreground">
              Workflow is invalid: {invalidAgents} {invalidAgents === 1 ? "agent" : "agents"} without a
              chosen template. Select an agent in the "Agents" column.
            </p>
          )}
        </div>
        {output && (
          <pre className="max-h-32 shrink-0 overflow-auto border-b border-border bg-muted p-2 text-xs text-foreground" aria-label="output">
            {output}
          </pre>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <button
            type="button"
            onClick={() => {
              editorStore.newWorkflow();
              setSelectedPath(null);
            }}
            className="mb-3 flex w-full items-center justify-center rounded-md border border-border bg-muted/40 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            + New workflow
          </button>
          {/* Flat list: separation by project is already defined by "Area" in the Cloud Config header. */}
          <WfList items={items} onOpen={openItem} activePath={identity?.path} />
        </div>
      </div>

      <ResizeHandle onPointerDown={startListResize} />

      <div style={{ width: constructorWidth }} className="h-full min-h-0 min-w-0 shrink-0 overflow-hidden">
        {codeOnly ? (
          <CodeOnlyView source={rawSource!} />
        ) : (
          <OutlineEditor
            agents={agents}
            selectedPath={selectedPath}
            onSelect={setSelectedPath}
          />
        )}
      </div>

      <ResizeHandle onPointerDown={startConstructorResize} />

      {!codeOnly && selAgent && (
        // Column 4 — combined: agent list (template picker) or, after
        // selection, the detail — the template file in Kasimov rendering on
        // top and step editing (model·effort, instructions, output format)
        // below. It doesn't hold its own width — it takes up all the
        // remaining page width; toggling between list and detail is done by
        // clicking an agent / the "Back" button, not the neighboring column.
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-l border-border">
          {pickerOpen ? (
            <div className="flex h-full flex-col gap-0.5 overflow-y-auto p-2">
              <div className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Agents
              </div>
              {agents.map((a) => (
                <button
                  key={a.path ?? a.value}
                  type="button"
                  onClick={() => {
                    editorStore.update((draft) =>
                      applyTemplate(draft, selectedPath!, a.value, { model: a.model, effort: a.effort, provider: a.provider }),
                    );
                    setPickerOpen(false);
                  }}
                  className="block w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted"
                >
                  <div className="truncate text-sm font-medium">{a.value}</div>
                  <div className="text-xs text-muted-foreground">{AGENT_SCOPE_LABEL[a.scope ?? "user"]}</div>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-col overflow-hidden">
              {/* No template file (the agent hasn't loaded yet / has no .md)
                  — AgentDetails below has no header of its own, so the back
                  button is kept here separately. Once the file exists, it
                  moves into MdDocView's shared header (leading below) — so the
                  arrow, file path, and "Edit" end up on one line. */}
              {!selAgentPath && (
                <div className="flex shrink-0 items-center border-b border-border p-1">
                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted"
                    aria-label="Back to the agent list"
                  >
                    ← Agents
                  </button>
                </div>
              )}
              {selAgentPath && (
                <>
                  <div style={{ height: agentFileHeight }} className="shrink-0 overflow-hidden">
                    <ColumnMdDocView
                      areaId={areaId}
                      initialPath={selAgentPath}
                      leading={
                        <button
                          type="button"
                          onClick={() => setPickerOpen(true)}
                          className="mdo-back"
                          aria-label="Back to the agent list"
                        >
                          ←
                        </button>
                      }
                      editButton={(onClick) => (
                        <button
                          type="button"
                          onClick={onClick}
                          className="mdo-btn mdo-btn-icon"
                          aria-label="Edit"
                          title="Edit"
                        >
                          <Icon name="Edit" className="size-4" />
                        </button>
                      )}
                    />
                  </div>
                  <HorizontalResizeHandle onPointerDown={startAgentFileResize} />
                </>
              )}
              <div className="min-h-0 flex-1 overflow-hidden">
                <AgentDetails
                  agent={selAgent}
                  agents={agents}
                  providerCatalog={providerCatalog}
                  onSetField={(patch) => editorStore.update((draft) => setAgentField(draft, selectedPath!, patch))}
                />
              </div>
            </div>
          )}
        </div>
      )}

      <WfSaveDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        rpc={rpc}
        projectId={projectId}
        tree={tree}
        defaultName={identity?.name ?? tree.name}
        defaultStore={identity?.store ?? (projectId ? "project" : "global")}
        onSaved={(nextIdentity) => {
          editorStore.load(structuredClone(editorStore.getSnapshot().tree), nextIdentity);
          refresh();
        }}
      />
    </div>
  );
}

function ConfigPanel({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [areas, setAreas] = useState<{ id: string; label: string }[]>([]);
  const [areaId, setAreaId] = useState("global");
  const [config, setConfig] = useState<AreaConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [memory, setMemory] = useState<
    { id: string; label: string; path: string }[]
  >([]);
  // Which creation dialog is open: skill, agent, or none.
  const [createKind, setCreateKind] = useState<"skill" | "agent" | null>(null);
  // Active section in the middle column; null → empty state.
  const [section, setSection] = useState<SectionId | null>(null);
  // Enabled-skills mode — shared across the whole section (one dropdown in
  // the header, not per skill). Enabling a skill applies this mode.
  const [skillMode, setSkillMode] = useState<SkillMode>("on");

  // What's open in the second column (for highlighting), if it belongs to this area.
  const open = parseDocSubPath(subPath);
  // The rail and middle column (section list) — bounded, resizable width; the
  // handle sits on the right edge of each one (side "left"). The document
  // takes up the rest (flex-1) and has no handle of its own.
  const { width: railWidth, startResize: startRailResize } = useResizableWidth({
    initial: 240,
    min: 180,
    max: 400,
    side: "left",
    storageKey: "claude-config:rail-width",
  });
  const { width: midWidth, startResize: startMidResize } = useResizableWidth({
    initial: 360,
    min: 260,
    max: 640,
    side: "left",
    storageKey: "claude-config:section-width",
  });
  const openHere = open && open.areaId === areaId ? open : null;
  const selectedName = openHere?.kind === "skill" ? openHere.name : null;
  const selectedPluginKey = openHere?.kind === "plugin" ? openHere.key : null;
  const selectedConnector = openHere?.kind === "connector" ? openHere : null;
  const selectedHook = openHere?.kind === "hook" ? openHere : null;
  // Open file by path (plugin README or memory) — highlighted on match.
  const openDocPath = openHere?.kind === "doc" ? openHere.path : null;

  useEffect(() => {
    void rpc.call("listAreas").then((result) => {
      if ("areas" in result) setAreas(result.areas);
    });
  }, [rpc]);

  useEffect(() => {
    let alive = true;
    void rpc.call("listMemory", { areaId }).then((result) => {
      if (alive && "entries" in result) setMemory(result.entries);
    });
    return () => {
      alive = false;
    };
  }, [areaId, rpc]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void rpc
      .call("getConfig", { areaId })
      .then((next) => {
        if (alive) {
          setConfig(next as AreaConfig);
          setLoading(false);
        }
      })
      // An RPC rejection (e.g. the output failed its own contract) left this
      // stuck on "Loading..." forever with nothing to show for it — a real
      // failure needs a real message, not silence.
      .catch((error: unknown) => {
        if (alive) {
          setNotice(error instanceof Error ? error.message : "Failed to load.");
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
    // Reset notice on area change — the old reason no longer applies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaId, rpc]);

  // Reloading after a write does NOT touch loading: the cards stay mounted,
  // values update in place — the page doesn't jump back to the top.
  const reload = () => {
    void rpc
      .call("getConfig", { areaId })
      .then((next) => {
        setConfig(next as AreaConfig);
      })
      .catch((error: unknown) => {
        setNotice(error instanceof Error ? error.message : "Failed to reload.");
      });
  };

  // Write outcome: ok — reload the area; otherwise show the reason in a
  // banner, also reloading, so the file's actual state is shown.
  const handleResult = (result: WriteOutcome) => {
    setNotice(result.outcome === "ok" ? null : result.message);
    reload();
  };

  const setPlugin = (key: string, value: boolean) =>
    void rpc.call("setPlugin", { areaId, key, value }).then(handleResult);
  const setConnector = (name: string, value: boolean) =>
    void rpc.call("setConnector", { areaId, name, value }).then(handleResult);
  const setSkill = (name: string, state: SkillTarget) =>
    void rpc.call("setSkill", { areaId, name, state }).then(handleResult);
  const setToolSearch = (mode: ToolSearchTarget) =>
    void rpc.call("setToolSearch", { areaId, mode }).then(handleResult);
  const setHookEnabled = (
    hook: {
      origin: HookOrigin;
      event: string;
      matcher: string | null;
      command: string;
      index: number;
    },
    enabled: boolean,
  ) => {
    // Toggling moves the hook in or out of the level's flat hook list (cut
    // to/from the disabled kv store) — the same index-shift `saveHookDefinition`
    // already guards against. If this exact hook is open, its subPath's index
    // is about to go stale; land back on the list rather than show a
    // confusing "not found" for a hook whose state just changed.
    if (
      selectedHook &&
      selectedHook.origin === hook.origin &&
      selectedHook.event === hook.event &&
      selectedHook.index === hook.index
    ) {
      navigate.toPluginPanel(PANEL_PATH, { subPath: "", replace: true });
    }
    void rpc
      .call("setHookEnabled", {
        areaId,
        origin: hook.origin,
        event: hook.event,
        matcher: hook.matcher,
        command: hook.command,
        enabled,
      })
      .then(handleResult);
  };

  const changeArea = (id: string) => {
    setNotice(null);
    setAreaId(id);
    // The skill selection belongs to the previous area — clear it.
    navigate.toPluginPanel(PANEL_PATH, { subPath: "", replace: true });
  };
  // Skill, agent, document — real files: open with bb's native opener.
  const openFile = useOpenFile(areaId);
  const openPlugin = (key: string) =>
    navigate.toPluginPanel(PANEL_PATH, { subPath: pluginSubPath(areaId, key) });
  const openConnector = (origin: ConnectorOrigin, name: string) =>
    navigate.toPluginPanel(PANEL_PATH, {
      subPath: connectorSubPath(areaId, origin, name),
    });
  const openHook = (origin: HookOrigin, index: number, event: string) =>
    navigate.toPluginPanel(PANEL_PATH, {
      subPath: hookSubPath(areaId, origin, index, event),
    });

  // Creating a skill: on success, reload the list and open the new SKILL.md
  // with the native opener; otherwise the dialog stays open with a message
  // (name taken/invalid).
  const createSkill = (name: string): Promise<string | null> =>
    rpc.call("createSkill", { areaId, name }).then((result) => {
      if (result.outcome === "created") {
        setCreateKind(null);
        reload();
        if (result.path) void openFile(result.path);
        return null;
      }
      return result.message ?? "Failed to create the skill.";
    });

  // Creating an agent: on success, open the new file at the path from the server response.
  const createAgent = (name: string): Promise<string | null> =>
    rpc.call("createAgent", { areaId, name }).then((result) => {
      if (result.outcome === "created" && result.path) {
        setCreateKind(null);
        reload();
        void openFile(result.path);
        return null;
      }
      return result.message ?? "Failed to create the agent.";
    });

  // Workflow count for the rail — from wfList for the current area (config doesn't carry it).
  const wfCount = useWfCount(rpc, areaId);

  // Rail sections: id → title and item count. Derived from config so the
  // rail and content don't drift apart. A null count — a section without a
  // list.
  const sections: { id: SectionId; title: string; count: number | null }[] =
    config && !config.error
      ? [
          { id: "hooks", title: "Hooks", count: config.hooks.length },
          { id: "plugins", title: "Plugins", count: config.plugins.length },
          { id: "connectors", title: "Connectors", count: config.connectors.length },
          { id: "skills", title: "Skills", count: config.skills.length },
          { id: "agents", title: "Agents", count: config.agents.length },
          { id: "workflows", title: "Workflows", count: wfCount },
          { id: "toolSearch", title: "Tool search", count: null },
        ]
      : [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Shared header: area + write banners — above all columns. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">Area</span>
          <ProjectSwitcher
            options={areas.map((area) => ({ key: area.id, label: area.label }))}
            isSelected={(key) => key === areaId}
            onSelect={(key) => changeArea(String(key))}
          />
        </div>
        {config?.editedFilePath && (
          <p className="text-xs text-muted-foreground">
            Writes to {config.editedFilePath}
          </p>
        )}
        {notice && (
          <div className="w-full rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {notice}
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Outer navigation level: memory + sections. */}
        <nav
          style={{ width: railWidth }}
          className="flex shrink-0 flex-col gap-4 overflow-y-auto p-2"
        >
          {memory.length > 0 && (
            <div>
              <div className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Memory
              </div>
              {memory.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  title={entry.path}
                  // A memory file supersedes the section: there should be no middle column.
                  onClick={() => {
                    setSection(null);
                    void openFile(entry.path);
                  }}
                  className={cn(
                    "flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted",
                    openDocPath === entry.path && "bg-accent",
                  )}
                >
                  <span className="truncate">{entry.label}</span>
                </button>
              ))}
            </div>
          )}

          <div>
            <div className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Sections
            </div>
            {sections.map((item) => (
              <button
                key={item.id}
                type="button"
                // Changing the section clears both the list (it re-renders)
                // and the document (close the open file — the 3rd column
                // empties).
                onClick={() => {
                  setSection(item.id);
                  navigate.toPluginPanel(PANEL_PATH, {
                    subPath: "",
                    replace: true,
                  });
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted",
                  section === item.id && "bg-accent",
                )}
              >
                <span className="truncate">{item.title}</span>
                {item.count != null && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    {item.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </nav>

        <ResizeHandle onPointerDown={startRailResize} />

        {loading ? (
          <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
            Loading…
          </div>
        ) : config?.error ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-5">
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Failed to parse file {config.error.file}: {config.error.message}
            </div>
          </div>
        ) : open && section === null ? (
          // Memory file: the document takes the full remaining width, no middle column.
          <div className="min-h-0 flex-1 overflow-hidden">
            <DocTab subPath={subPath} />
          </div>
        ) : section === "workflows" ? (
          <WorkflowsView rpc={rpc} areaId={areaId} />
        ) : section !== null ? (
          <>
            {/* Middle column — the section list, bounded resizable width. */}
            <div
              style={{ width: midWidth }}
              className="min-h-0 shrink-0 overflow-y-auto p-4"
            >
              <div className="space-y-4">
            {config && !config.error && section === "hooks" && (
              <div>
                <h2 className="mb-2 text-sm font-semibold">Hooks</h2>
                {config.hooks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No hooks found.
                  </p>
                ) : (
                  <p className="mb-2 text-xs text-muted-foreground">
                    The toggle disables a hook — Claude Code doesn't disable it
                    on its own, so the panel cuts the hook out into its own
                    storage and restores it on enable. Clicking the row opens
                    and edits the command.
                  </p>
                )}
                <div className="space-y-0.5">
                  {config.hooks.map((hook) => {
                    const selected =
                      selectedHook?.origin === hook.origin &&
                      selectedHook?.index === hook.index &&
                      selectedHook?.event === hook.event;
                    const infoContent = (
                      <>
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {hook.event}
                          </span>
                          {hook.matcher && (
                            <span className="shrink-0 text-xs text-muted-foreground">
                              matcher: {hook.matcher}
                            </span>
                          )}
                          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                            {HOOK_ORIGIN_LABEL[hook.origin]}
                          </span>
                        </div>
                        <div className="truncate font-mono text-xs text-muted-foreground">
                          {hook.command}
                        </div>
                      </>
                    );
                    return (
                      <div
                        key={`${hook.origin}:${hook.event}:${hook.index}:${hook.command}`}
                        className={cn(
                          "flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors",
                          hook.enabled && "hover:bg-muted",
                          selected && "bg-accent",
                          !hook.enabled && "opacity-60",
                        )}
                      >
                        {hook.enabled ? (
                          <button
                            type="button"
                            onClick={() =>
                              openHook(hook.origin, hook.index, hook.event)
                            }
                            className="min-w-0 flex-1 text-left"
                          >
                            {infoContent}
                          </button>
                        ) : (
                          <div className="min-w-0 flex-1">{infoContent}</div>
                        )}
                        <Switch
                          checked={hook.enabled}
                          onChange={(next) => setHookEnabled(hook, next)}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {!loading && config && !config.error && section === "plugins" && (
              <div>
                <h2 className="mb-2 text-sm font-semibold">
                  Claude Code plugins
                </h2>
                {config.plugins.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No installed plugins found.
                  </p>
                )}
                <div className="space-y-0.5">
                  {config.plugins.map((plugin) => (
                    <div
                      key={plugin.key}
                      className={cn(
                        "flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors",
                        plugin.installPath && "hover:bg-muted",
                        selectedPluginKey === plugin.key && "bg-accent",
                        plugin.dimmed && "opacity-60",
                      )}
                    >
                      {plugin.installPath ? (
                        <button
                          type="button"
                          onClick={() => openPlugin(plugin.key)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="truncate text-sm font-medium">
                            {plugin.name}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {secondLine(plugin.tokens, plugin.version ?? "")}
                          </div>
                        </button>
                      ) : (
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">
                            {plugin.name}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {secondLine(plugin.tokens, plugin.version ?? "")}
                          </div>
                        </div>
                      )}
                      <Switch
                        checked={plugin.value}
                        onChange={(next) => setPlugin(plugin.key, next)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!loading && config && !config.error && section === "connectors" && (
              <div>
                <h2 className="mb-2 text-sm font-semibold">Connectors</h2>
                {config.connectors.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No connectors found.
                  </p>
                )}
                <div className="space-y-0.5">
                  {config.connectors.map((connector) => (
                    <div
                      key={`${connector.origin}:${connector.name}`}
                      className={cn(
                        "flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-muted",
                        selectedConnector?.name === connector.name &&
                          selectedConnector?.origin === connector.origin &&
                          "bg-accent",
                        connector.dimmed && "opacity-60",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          openConnector(connector.origin, connector.name)
                        }
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="truncate text-sm font-medium">
                          {connector.name}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {secondLine(
                            connector.tokens,
                            connectorSubtitle(
                              connector.origin,
                              connector.transport,
                            ),
                          )}
                        </div>
                      </button>
                      {connector.toggleable ? (
                        <Switch
                          checked={connector.value}
                          onChange={(next) =>
                            setConnector(connector.name, next)
                          }
                        />
                      ) : (
                        // user/local from ~/.claude.json settings.json isn't gated.
                        <span className="shrink-0 text-xs text-muted-foreground">
                          read only
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!loading && config && !config.error && section === "skills" && (
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold">Skills</h2>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCreateKind("skill")}
                  >
                    <Icon name="Plus" />
                    New skill
                  </Button>
                </div>
                {/* Mode is shared for the section: applied to all enabled
                    skills and to each one being enabled. Shown as its own
                    labeled row. */}
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    Enabled skills mode
                  </span>
                  <Dropdown
                    value={skillMode}
                    options={SKILL_MODE_OPTIONS}
                    disabled={false}
                    onChange={(mode) => {
                      setSkillMode(mode);
                      for (const skill of config.skills) {
                        if (skill.enabled) setSkill(skill.name, mode);
                      }
                    }}
                  />
                </div>
                {config.skills.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No skills found.
                  </p>
                )}
                <div className="space-y-0.5">
                  {config.skills.map((skill) => (
                    <div
                      key={skill.name}
                      className={cn(
                        "flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-muted",
                        selectedName === skill.name && "bg-accent",
                        skill.dimmed && "opacity-60",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          skill.path
                            ? void openFile(skill.path)
                            : toast.error("Skill file not found.")
                        }
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="truncate text-sm font-medium">
                          {skill.name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {secondLine(
                            skill.tokens,
                            skill.origin === "project" ? "project" : "personal",
                          )}
                        </div>
                      </button>
                      <Switch
                        checked={skill.enabled}
                        // Enable using the section's shared mode, disable via off.
                        onChange={(next) =>
                          setSkill(skill.name, next ? skillMode : "off")
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!loading && config && !config.error && section === "agents" && (
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold">Agents</h2>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCreateKind("agent")}
                  >
                    <Icon name="Plus" />
                    New agent
                  </Button>
                </div>
                {config.agents.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No agents found.
                  </p>
                )}
                <div className="space-y-0.5">
                  {config.agents.map((agent) => (
                    <button
                      key={agent.path}
                      type="button"
                      onClick={() => void openFile(agent.path)}
                      className={cn(
                        "block w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted",
                        openDocPath === agent.path && "bg-accent",
                      )}
                    >
                      <div className="truncate text-sm font-medium">
                        {agent.name}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {secondLine(
                          agent.tokens,
                          agent.origin === "project" ? "project" : "personal",
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {!loading && config && !config.error && section === "toolSearch" && (
              <div className={cn(config.toolSearch.dimmed && "opacity-60")}>
                <h2 className="mb-2 text-sm font-semibold">
                  Tool search
                </h2>
                <p className="mb-3 text-xs text-muted-foreground">
                  Plugin and MCP tool schemas aren't all loaded into context at
                  once — only the list of names is visible, and the full schema
                  is fetched on demand when a tool is needed. Saves context,
                  especially with many MCP servers. "Always" — defer loading
                  always; "Automatic" — only when there are many tools; off —
                  load all schemas up front.
                </p>
                <div className="flex shrink-0 items-center gap-3">
                  <Dropdown
                    value={config.toolSearch.mode}
                    options={TOOL_SEARCH_MODE_OPTIONS}
                    disabled={!config.toolSearch.enabled}
                    onChange={(mode) => setToolSearch(mode)}
                  />
                  <Switch
                    checked={config.toolSearch.enabled}
                    onChange={(next) =>
                      setToolSearch(next ? config.toolSearch.mode : "off")
                    }
                  />
                </div>
              </div>
            )}
              </div>
            </div>

            {/* Divider between the middle column and the document — takes the rest of the width. */}
            <ResizeHandle onPointerDown={startMidResize} />
            <div className="min-h-0 flex-1 overflow-hidden">
              {open ? (
                <DocTab subPath={subPath} />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Select an item from the list
                </div>
              )}
            </div>
          </>
        ) : (
          // Neither file nor section — empty state spanning the full width.
          <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
            Select a section on the left
          </div>
        )}
      </div>

      <CreateDialog
        open={createKind === "skill"}
        title="New skill"
        description="Creates a folder with SKILL.md and opens it for editing."
        onClose={() => setCreateKind(null)}
        onCreate={createSkill}
      />
      <CreateDialog
        open={createKind === "agent"}
        title="New agent"
        description="Creates an agent file and opens it for editing."
        onClose={() => setCreateKind(null)}
        onCreate={createAgent}
      />
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "claude-config",
    title: "Claude Config",
    icon: "Brain",
    path: PANEL_PATH,
    component: ConfigPanel,
  });
});
