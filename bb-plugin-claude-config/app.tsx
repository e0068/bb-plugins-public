// bb-plugin-claude-config — panel: area picker up top plus sections (hooks,
// plugins, connectors, skills, agents, tool search). Data and writes go
// through RPC to server.ts; this file only handles display and toggling.
// Every section's list carries the same header (SectionHeader): its title,
// from the one table in ./src/panel-sections, plus the "+" of the sections
// that can create — hooks, skills, agents, workflows. Deleting isn't there:
// it lives on the surface where the file is shown (DocTab's `actions`), so
// the button sits with the file rather than with its row. .mcp.json
// connectors are toggled by a switch; user/local ones are read-only.
//
// The SKILL.md of the selected skill (or any open document) is shown in the
// second column inside the panel itself — the DocTab component, handed what
// the panel's address says is open. This used to be a fixed tab in the right-hand host panel
// (experimental_fixedTabs), but in bb 0.40.0 navPanel with that option doesn't
// mount and the entry disappears from the sidebar (see task BP-53), so the
// content was moved into the column.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
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
import { docLibraries } from "./libraries";
import {
  NATIVE_VIEWER_TOKEN_DEFAULTS,
  parseKasimovSettings,
  kasimovCssVars,
  kasimovFlags,
} from "./packages/md-doc-view";
import {
  isHostOpen,
  opensInEditMode,
  readOpenerSettings,
} from "./src/open-action";
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
  CREATE_LABEL,
  SECTION_SPECS,
  sectionSpec,
  type CreateKind,
  type SectionId,
} from "./src/panel-sections";
import { HOOK_EVENTS, matcherHint, supportsMatcher } from "./src/hook-events";
import {
  DEFAULT_PLACE,
  panelRoute,
  parsePanelRoute,
  openKey,
  type ConnectorOrigin,
  type DocTarget,
  type HookOrigin,
  type OpenTarget,
  type PanelPlace,
  type WorkflowTarget,
} from "./src/panel-route";
import { useRememberedRoute } from "./packages/panel-state/react";
import {
  type FrontmatterEntry,
  parseFrontmatter,
  serializeFrontmatter,
  setFieldValue,
} from "./src/frontmatter";
import { MarkdownEditor } from "./packages/md-editor/react";
// The built-in editor's link classes — not Kasimov's: the two engines use different prefixes.
import { LINK_TOKEN_SELECTOR } from "./packages/md-editor/link-tokens";
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
import { isSameWorkflow } from "./src/workflow/identity";
import { compile, blankTree, type Engine, type Tree, type Agent, type Container, type Phase, type Step } from "./src/workflow/workflow-model";
import { applyTemplate, setAgentField, setGroupSettings, nodeAt, type OutlinePath } from "./src/workflow/outline-ops";
import { agentsMissingTemplate } from "./src/workflow/validity";
import {
  OutlineEditor,
  AgentDetails,
  GroupDetails,
  type AgentOption,
  type ProviderCatalogEntry,
} from "./components/workflow/outline-editor";

const PANEL_PATH = "claude-config";

/**
 * Move within the panel's current area and section: open something, or close
 * what's open (null). `replace` — putting a place back rather than taking a
 * step the user could go Back from.
 */
type GoTo = (open: OpenTarget | null, replace?: boolean) => void;

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

// Middle-column sections — picked from the rail, they determine what is
// shown. Their ids, titles and create actions live in ./src/panel-sections,
// so the rail and the section header read one table instead of two literals.

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

// Where the panel is — area, section and what's open — is its address, and
// the grammar of that address lives in ./src/panel-route: one parser, one
// builder, both tested. Nothing here assembles a subPath by hand.

// Open a real file per the `fileOpenerLocation` setting (memory/decisions/
// claude-config-opener-two-axes.md — supersedes claude-config-opener-setting.md).
// "inline" — in the embedded column (DocTab, which picks how to render what's
// open, per the separate `fileOpenerRenderer` setting). "host" — delegate to
// a bb host tab: the server resolves the host for the area and path, and bb's
// own generic preview renders it there. Skills, agents, and plugin READMEs
// are all real files and go through here. Synthesized views (connector, hook
// command) aren't files and don't.
function useOpenFile(
  areaId: string,
  /**
   * Where the panel lands: with the file open in its column (the path), or
   * with the file gone to a host tab and nothing of it here (null).
   */
  land: (path: string | null) => void,
): (path: string) => Promise<void> {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const settings = useSettings();
  const { location } = readOpenerSettings(settings.values as Record<string, unknown> | undefined);
  return async (path: string) => {
    if (!isHostOpen(location)) {
      land(path);
      return;
    }
    const { hostId, path: abs, error } = await rpc.call("resolveOpenTarget", {
      areaId,
      path,
    });
    if (!hostId || !abs) {
      toast.error(error ?? "Failed to open the file.");
      return;
    }
    // The path the SERVER resolved, not the one clicked: a Claude `@~/...`
    // import carries a tilde, and the host opener takes a plain absolute path.
    const opened = navigate.experimental_openFilePreview({
      target: { kind: "host", hostId, path: abs },
      location: null,
    });
    if (opened) land(null);
    else toast.error("The host declined to open the file.");
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
}: {
  areaId: string;
  initialPath: string;
  // Passed through to MdDocView as-is — the tab owner decides what to show at
  // the start of the shared header (see md-doc-view).
  leading?: ReactNode;
}) {
  const rpc = useRpc<typeof rpcContract>();
  // Kasimov look and flags — from the plugin settings (kasimov*). The parser
  // is total: while useSettings is loading (values === undefined) it returns
  // defaults that match kasimov.css.
  // The same preset defaults server.ts registered with buildDescriptors. Hand
  // them over, or the document is the engine's black until useSettings()
  // answers — and stays black on a remount that gets no values.
  const settings = parseKasimovSettings(useSettings().values, NATIVE_VIEWER_TOKEN_DEFAULTS);
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
      libraries={docLibraries}
      initialPath={initialPath}
      load={load}
      save={save}
      resolveLinkTarget={resolveLinkTarget}
      vars={vars}
      // All engine flags at once (toFlags returns exactly the MdDocView flag
      // props): a hand-written list is one `atLinks` away from a setting that
      // silently does nothing — see
      // memory/decisions/kasimov-atlink-click-guard.md.
      {...flags}
      leading={leading}
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
 * switch (see archive/bb-plugin-thread-handoff/components/ui/switch.tsx, the one
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

/** Single-line click-to-edit text field for a string/number setting. */
function TextSettingInput({
  value,
  onSave,
}: {
  value: string;
  onSave: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onSave(draft);
  };
  return (
    <Input
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => event.key === "Enter" && commit()}
      // Fills the control box (min 100px), instead of a fixed width that
      // couldn't shrink and forced the label's text into a sliver.
      className="h-8 w-full min-w-0"
    />
  );
}

/**
 * One row of the generic "Settings" section — the control depends on the
 * key's kind (see settings-catalog): a Switch for booleans (same widget and
 * "no explicit revert" convention as Plugins), a Dropdown for enums (as
 * Skills), a single-line field for strings/numbers, and a JSON block (the
 * same PlainTextBlock hooks uses for a script file) for nested objects. A
 * value already set explicitly gets a "Reset" action — the only way back to
 * "unset, Claude Code's own default applies" for kinds without an implicit
 * off/inherit position.
 */
function SettingField({
  setting,
  onChange,
}: {
  setting: AreaConfig["settings"][number];
  onChange: (value: string | null) => void;
}) {
  const label = (
    // The text never squeezes below 200px: in this column it used to share a
    // flex row with the control and got wrung out to one word per line.
    <div className="min-w-[200px] flex-1">
      <div className="text-sm font-medium">{setting.label}</div>
      <div className="text-xs text-muted-foreground">{setting.description}</div>
    </div>
  );

  const resetButton = setting.value !== null && (
    <button
      type="button"
      onClick={() => onChange(null)}
      className="shrink-0 text-xs text-muted-foreground hover:underline"
    >
      Reset
    </button>
  );

  // A JSON value is a multi-line block — it's full width under the label by
  // nature, and never sits beside it.
  if (setting.kind === "json") {
    return (
      <div
        className={cn("rounded-md px-2 py-1.5", setting.dimmed && "opacity-60")}
      >
        <div className="mb-1 flex items-start justify-between gap-2">
          {label}
          {resetButton}
        </div>
        <PlainTextBlock value={setting.value ?? ""} onSave={onChange} />
      </div>
    );
  }

  const options = setting.kind === "enum" ? (setting.enumOptions ?? []) : [];
  const control =
    setting.kind === "boolean" ? (
      <Switch
        checked={setting.value === "true"}
        onChange={(next) => onChange(next ? "true" : "false")}
      />
    ) : setting.kind === "enum" ? (
      <Dropdown
        value={setting.value ?? (options[0]?.value ?? "")}
        options={options}
        disabled={options.length === 0}
        onChange={(next) => onChange(next)}
      />
    ) : (
      <>
        <TextSettingInput value={setting.value ?? ""} onSave={onChange} />
        {resetButton}
      </>
    );

  // One wrapping row for every kind but JSON: the text keeps its 200px, the
  // control its 100px, and when the column can't hold both (under ~300px)
  // flex-wrap drops the control onto its own line under the label instead of
  // strangling the text.
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md px-2 py-1.5",
        setting.dimmed && "opacity-60",
      )}
    >
      {label}
      <div className="flex min-w-[100px] flex-1 basis-56 items-center justify-end gap-2">
        {control}
      </div>
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
 * Header above a section's list. One component for all seven — they used to
 * be seven `h2` rows and had drifted apart. A section with no create path
 * (see panel-sections) gets no "+".
 */
function SectionHeader({
  section,
  onCreate,
}: {
  section: SectionId;
  onCreate?: () => void;
}) {
  const spec = sectionSpec(section);
  return (
    <ColumnHeading
      title={spec.title}
      action={
        spec.create !== null && onCreate ? (
          <Button
            variant="outline"
            size="sm"
            className="w-8 px-0"
            onClick={onCreate}
            // Button drops `title` on purpose (see components/ui/button) — the
            // accessible name is what names this button.
            aria-label={CREATE_LABEL[spec.create]}
          >
            <Icon name="Plus" />
          </Button>
        ) : null
      }
    />
  );
}

/**
 * Heading of any column in the panel — the rail's groups and the section
 * lists alike. The rail used to have its own smaller uppercase caption and
 * tighter padding, which made the two columns read as two different panels.
 */
function ColumnHeading({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-2 flex h-8 items-center justify-between gap-2">
      <h2 className="truncate text-sm font-semibold">{title}</h2>
      {action}
    </div>
  );
}

/**
 * Confirmation around a delete; the trigger is the caller's (an icon in a
 * file's header, a button in the builder's row). Deleting isn't undoable from
 * the panel, so every delete asks first — one dialog, one wording.
 */
function ConfirmDelete({
  what,
  detail,
  onDelete,
  trigger,
}: {
  /** What is being deleted, for the labels: "skill", "agent", "hook". */
  what: string;
  /** Which one — name or path, shown in the confirmation. */
  detail: string;
  onDelete: () => void;
  trigger: (ask: () => void) => ReactNode;
}) {
  const [asking, setAsking] = useState(false);
  return (
    <>
      {trigger(() => setAsking(true))}
      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {what}?</DialogTitle>
            <DialogDescription>
              {detail} will be deleted from disk. This can't be undone from the
              panel.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAsking(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setAsking(false);
                onDelete();
              }}
              aria-label={`Confirm delete ${what}`}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Trigger for a file's own header: icon only, destructive on hover. */
const deleteIconTrigger =
  (what: string) =>
  (ask: () => void): ReactNode => (
    <Button
      variant="ghost"
      size="sm"
      className="w-8 px-0 text-muted-foreground hover:text-destructive"
      onClick={ask}
      aria-label={`Delete ${what}`}
    >
      <Icon name="Trash2" />
    </Button>
  );

/**
 * Dialog for creating a hook: the three fields Claude Code reads. A hook is
 * an entry in settings.json, not a file, so there's no name to slugify. The
 * matcher field only shows for events that group by one (see hook-events).
 */
function HookCreateDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (hook: {
    event: string;
    matcher: string | null;
    command: string;
  }) => Promise<string | null>;
}) {
  const [event, setEvent] = useState(HOOK_EVENTS[0]!.event);
  const [matcher, setMatcher] = useState("");
  const [command, setCommand] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setEvent(HOOK_EVENTS[0]!.event);
      setMatcher("");
      setCommand("");
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const withMatcher = supportsMatcher(event);
  const hint = matcherHint(event);
  const canSubmit = command.trim() !== "" && !busy;

  const submit = () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    void onCreate({
      event,
      // The field is hidden for events that don't group — don't smuggle a
      // stale value from a previously picked event into the file.
      matcher: withMatcher && matcher.trim() !== "" ? matcher.trim() : null,
      command,
    }).then((message) => {
      setBusy(false);
      if (message) setError(message);
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New hook</DialogTitle>
          <DialogDescription>
            Adds a hook to the file this area edits.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block space-y-1.5">
            <span className="text-xs text-muted-foreground">Event</span>
            <select
              aria-label="hook event"
              value={event}
              onChange={(e) => setEvent(e.target.value)}
              className="flex h-9 w-full items-center rounded-md border border-border bg-transparent px-3 text-sm text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {HOOK_EVENTS.map((spec) => (
                <option key={spec.event} value={spec.event}>
                  {spec.event}
                </option>
              ))}
            </select>
          </label>
          {withMatcher && (
            <label className="block space-y-1.5">
              <span className="text-xs text-muted-foreground">
                Matcher (optional)
              </span>
              <Input
                aria-label="hook matcher"
                placeholder={hint ?? ""}
                value={matcher}
                onChange={(e) => setMatcher(e.target.value)}
              />
              {hint && (
                <span className="block text-xs text-muted-foreground">
                  Matches: {hint}
                </span>
              )}
            </label>
          )}
          <label className="block space-y-1.5">
            <span className="text-xs text-muted-foreground">Command</span>
            <Input
              autoFocus
              aria-label="hook command"
              placeholder="~/.claude/hooks/my-hook.sh"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </label>
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
 * Right-hand tab: shows the document the address names — a skill's
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
}: {
  entries: FrontmatterEntry[];
  onChange: (index: number, value: string) => void;
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
                    <textarea
                      rows={1}
                      value={field.value}
                      onChange={(event) =>
                        onChange(field.index, event.target.value)
                      }
                      className="cc-fm-value"
                    />
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

function DocTab({
  areaId,
  target,
  goTo,
  actions,
}: {
  areaId: string;
  /** What to show; null — nothing is open. Never a workflow: that section
   * has its own builder, not this column. */
  target: DocTarget | null;
  /** Move within the current place — open another file, or close this one. */
  goTo: GoTo;
  /**
   * Actions for the open file — delete lives on the surface where the file is
   * shown, not next to its row. What is deletable is the section's business,
   * so the buttons are passed in: a plugin README and a memory file come
   * through this same column and are nobody's to delete.
   */
  actions?: ReactNode;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const settingValues = useSettings().values;
  const { renderer } = readOpenerSettings(settingValues as Record<string, unknown> | undefined);
  // Same setting the Kasimov column honours through MdDocView's startInEdit
  // prop (see ColumnMdDocView) — read here for the older renderer below.
  const { startInEdit } = parseKasimovSettings(settingValues, NATIVE_VIEWER_TOKEN_DEFAULTS);
  // A real file with the `md-opener` renderer is rendered by MdDocView
  // (which also loads and edits it). The composite/hook branches and the
  // `builtin` renderer follow the old path below.
  const mdOpenerDoc = target?.kind === "doc" && renderer === "md-opener";

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

  // Assemble the file's content from the fields and body: with frontmatter —
  // serialize the block, without it — the body is the whole file.
  const composeContent = (entries: FrontmatterEntry[], body: string) =>
    hasFm ? serializeFrontmatter(entries, body) : body;

  // Split the document into frontmatter and body. Composite (connector) and
  // hook have their own representation — leave them alone, body = the
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
  // `kind` — what is being shown. "file" is a standalone document, the thing
  // the "open documents in edit mode" setting talks about; "synthesized" is a
  // connector view the server assembled or a hook command lifted out of
  // settings.json — those stay a read even with the setting on.
  const present = (result: Loaded, kind: "file" | "synthesized" = "file") => {
    const startEditing = opensInEditMode(
      startInEdit,
      result,
      kind === "synthesized",
    );
    setDoc(result);
    setEditing(startEditing);
    if (startEditing) setDraft(result.content ?? "");
    setSaveNote(null);
    setLoading(false);
    // Extra hook data is only set by the hook branch; reset it for other documents.
    setHookExtra(null);
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

  // First render of a target: the server resolves a skill (readSkillFile), any
  // file — by absolute path (readDoc, this covers plugin READMEs too). We
  // push the absolute path onto the stack — "back" and links use it.
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

    if (target.kind === "connector") {
      void rpc
        .call("readConnector", {
          areaId,
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
          present(
            {
              path: result.path,
              content: "```json\n" + result.content + "\n```",
              error: null,
              sha256: null,
            },
            "synthesized",
          );
        });
      return () => {
        ok = false;
      };
    }

    if (target.kind === "hook") {
      void rpc
        .call("readHook", {
          areaId,
          origin: target.origin,
          index: target.index,
        })
        .then((result) => {
          if (!ok) return;
          setStack(result.path ? [result.path] : []);
          // A raw command (bash), not markdown assembly — edited with the same
          // MarkdownEditor as a regular document (see writeHook in save()).
          setComposite(false);
          present(
            {
              path: result.path,
              content: result.command,
              error: result.error,
              sha256: result.sha256,
            },
            "synthesized",
          );
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
            areaId,
            name: target.name,
            relPath: "SKILL.md",
          })
        : rpc.call("readDoc", { areaId, path: target.path });
    void request.then((result) => {
      if (!ok) return;
      setStack(result.path ? [result.path] : []);
      present(result);
    });
    return () => {
      ok = false;
    };
    // What's open is the address, and openKey is its identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey(target), rpc, mdOpenerDoc]);

  // A file link inside the shown document (README, editor link) is a real
  // file: open it with bb's native opener rather than loading it into the
  // embedded column.
  const openFile = useOpenFile(areaId, (path) => {
    if (path !== null) goTo({ kind: "doc", path });
  });
  const openAbs = (abs: string) => void openFile(abs);

  // Click on a file link inside a composite (connector) document: it's
  // rendered by the host `Markdown` component, not MarkdownEditor, since it's
  // an assembled view — not a standalone markdown file. We catch `<a>`
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
  // file, so `target.index` (baked into the current address) may no longer
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
          goTo(null, true);
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
        {/* MdDocView's header isn't extended with a slot of its own — see
            memory/decisions/file-actions-stay-in-plugin.md — so the file's
            actions get a thin row above it. */}
        {actions && (
          <div className="flex shrink-0 items-center justify-end gap-1 border-b border-border px-2 py-1">
            {actions}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-hidden">
          <ColumnMdDocView areaId={areaId} initialPath={target.path} />
        </div>
      </div>
    );
  }

  const heading =
    target.kind === "skill" || target.kind === "connector"
      ? target.name
      : target.kind === "hook"
        ? target.event
        : (doc?.path?.split("/").pop() ?? "");
  // Composite (connector) is not editable — it's a slice of a larger file.
  const canEdit = !!doc && doc.content != null && !doc.error && !composite;

  // Clicking text in view mode enters edit mode. Links (LINK_TOKEN_SELECTOR —
  // `[..](..)` AND `@import`) are handled by the editor itself via
  // linkResolver, inline code like `references/x.md` — a navigation;
  // everything else — startEdit. In edit mode, clicks are handled by the editor.
  const onDocClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (editing) return;
    const el = event.target as HTMLElement;
    if (el.closest(LINK_TOKEN_SELECTOR)) return;
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
          {doc?.path && (
            <div className="truncate text-xs text-muted-foreground">
              {doc.path}
            </div>
          )}
          {saveNote && (
            <div className="text-xs text-destructive">{saveNote}</div>
          )}
        </div>
        {/* Not editing — the file's own actions (delete) sit in this header,
            the same row as its name and path. */}
        {!editing && actions && (
          <div className="flex shrink-0 items-center gap-1">{actions}</div>
        )}
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
        {/* Connector: the definition is a JSON slice, not a standalone
            document — the plain host Markdown renderer fits a fenced code
            block just as well and keeps the composite-link click handling.
            (The only composite target left — plugins now open their README
            as a real file, same path as skills.) */}
        {!loading && doc?.content != null && composite && (
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
                      goTo({ kind: "doc", path: hookExtra.filePath }),
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
const AGENT_SCOPE_LABEL: Record<"user" | "project" | "plugin" | "builtin", string> = {
  user: "personal",
  project: "project",
  plugin: "plugin",
  builtin: "builtin",
};

// Claude Code agent types with no `.md` file for wfAgents to discover — pinned ahead of the
// scanned catalog so they're always reachable as a template, not lost among alphabetical results.
const BUILTIN_AGENTS: AgentOption[] = [
  { value: "general-purpose", model: "", effort: "", provider: "", description: "General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks.", scope: "builtin" },
];

function useWfAgents(rpc: Rpc, projectId: string | null): AgentOption[] {
  const [agents, setAgents] = useState<AgentOption[]>([]);
  useEffect(() => {
    void rpc.call("wfAgents", { projectId }).then((r) => setAgents(r.agents));
  }, [rpc, projectId]);
  return [...BUILTIN_AGENTS, ...agents.filter((a) => !BUILTIN_AGENTS.some((b) => b.value === a.value))];
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
  open,
  draft,
}: {
  items: WfItem[];
  onOpen: (i: WfItem) => void;
  /** The workflow the builder has open — its row is highlighted. */
  open: Identity | null;
  /** A new workflow is being written — it has no file, so it gets a row of its own. */
  draft: boolean;
}) {
  return (
    <div className="space-y-1">
      {draft && (
        // Without this row the builder would be showing a workflow while the
        // list highlighted nothing — which reads as a lost selection.
        <div className="flex w-full items-center gap-2 rounded-md bg-accent px-2 py-1.5 text-left text-sm">
          <span className="min-w-0 flex-1 truncate">New workflow</span>
          <span className="shrink-0 text-xs text-muted-foreground">unsaved</span>
        </div>
      )}
      {items.length === 0 && <div className="px-1 py-0.5 text-xs text-muted-foreground">empty</div>}
      {items.map((item) => (
        <button
          key={item.path}
          type="button"
          onClick={() => onOpen(item)}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted",
            // Comparing paths alone lost the highlight whenever the listed
            // path came from another checkout of the same project — see
            // isSameWorkflow.
            isSameWorkflow(open, item) && "bg-accent",
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
//
// Column 2 is shaped like any other section's list: header with "+", then the
// rows. Delete and Save belong to the workflow that's open, so they sit at
// the foot of column 3 — under the tree they act on. Validating and running a
// workflow left the panel with them (the wfValidate/wfRun/wfStatus procedures
// are still on the server); `bb workflows` is where a run belongs.
function WorkflowsView({
  rpc,
  areaId,
  target,
  goTo,
}: {
  rpc: Rpc;
  areaId: string;
  /** The workflow the address names; null — none. */
  target: WorkflowTarget | null;
  goTo: GoTo;
}) {
  const { tree, identity, rawSource, draft } = useEditor();
  const codeOnly = rawSource != null;
  // Nothing open at all: no file, no new workflow started. The builder shows
  // an empty state rather than a blank tree that looks like an open document
  // with no row highlighted next to it.
  const nothingOpen = identity === null && !draft;

  // Workflow project — the same axis as "Area" in the Cloud Config header: the
  // sentinel "global" means the global area, any other areaId value is a
  // bb project id.
  const projectId = areaId === "global" ? null : areaId;
  // The list and the area it was fetched for are one value, so "a list left
  // over from the previous area" is not a state this can hold: a reply that
  // arrives after the area changed simply isn't this area's list, and the
  // effect below waits instead of acting on it.
  const [listing, setListing] = useState<{
    projectId: string | null;
    items: WfItem[];
  } | null>(null);
  const listed = listing !== null && listing.projectId === projectId;
  const items = listed ? listing.items : [];
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
    void rpc
      .call("wfList", { projectId })
      .then((r) => setListing({ projectId, items: r.items as WfItem[] }));
  };
  // rpc — a stable reference for the panel's lifetime, refresh — a new
  // function on every render; the dependency list only needs what actually
  // changes the list.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, [projectId]);

  // Opening is addressed by store+path+name — the three things both a list
  // row and the remembered note carry.
  const openWorkflow = async (ref: Identity) => {
    const res = await rpc.call("wfRead", { projectId, store: ref.store, path: ref.path });
    const parsedTree = res.tree as Tree | null;
    // No builder tree → a hand-written file: open it as-is, read-only.
    editorStore.load(
      parsedTree ?? blankTree(ref.name),
      ref,
      parsedTree ? null : res.source,
    );
    setSelectedPath(null);
  };
  // Clicking a row only changes the address; opening is the effect below, so
  // there is one way in — a click, a link and the Back button all take it.
  const openItem = (item: WfItem) =>
    goTo({ kind: "workflow", store: item.store, name: item.name });

  // Open what the address names. The builder's store is module-level and
  // survives leaving the panel, so a file is re-read only when the address
  // names one OTHER than the one already open — coming back to the same
  // workflow must not throw away unsaved edits. The list is what turns a
  // name into a path (paths differ between a project's checkouts, names
  // don't — see src/workflow/identity.ts), so this waits for the list.
  const targetName = target === null ? "" : `${target.store}/${target.name}`;
  useEffect(() => {
    if (target === null) return;
    if (identity?.store === target.store && identity.name === target.name) return;
    const row = items.find(
      (item) => item.store === target.store && item.name === target.name,
    );
    if (!row) {
      // No such row in a list that HAS arrived — the address names a workflow
      // that is gone. Drop it, or the panel sits on "open" with an empty
      // builder for good, restart included. An empty list that hasn't arrived
      // yet says nothing, so it waits.
      if (listed) goTo(null, true);
      return;
    }
    openWorkflow({ store: row.store, path: row.path, name: row.name }).catch(() =>
      // The row is in the list but won't read — a file removed underneath us.
      goTo(null, true),
    );
    // Identity is deliberately not a dependency: this reacts to the address
    // and to the list arriving, not to the builder's own state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetName, items, listed]);

  const doDelete = async () => {
    if (!identity) return;
    await rpc.call("wfRemove", { projectId: projectId, store: identity.store, path: identity.path });
    toast.success("Workflow deleted");
    editorStore.newWorkflow();
    setSelectedPath(null);
    goTo(null, true);
    refresh();
  };

  // Selected node (for the combined column 4): the node at selectedPath, whichever kind it is.
  const node: Phase | Step | null = selectedPath ? nodeAt(tree, selectedPath) : null;
  const selAgent: Agent | null = node && "type" in node && node.type === "agent" ? node : null;
  // A Phase has no `type` field at all; a Container's is "container" — either owns the BP-134 node
  // settings (Maximum Parallel / Iterate over / Repeat), shown by GroupDetails in the same column.
  const selGroup: Phase | Container | null = node && (!("type" in node) || node.type === "container") ? node : null;
  const previewEngine: Engine = engineForStore(identity?.store ?? (projectId ? "project" : "global"));
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
      {/* Column 2 — the list, shaped like every other section: a header with
          the section's "+" and nothing else. Save / Validate / Run / Delete
          used to live here even though they act on the workflow shown in the
          next column; they moved there. */}
      <div style={{ width: listWidth }} className="flex h-full shrink-0 flex-col overflow-hidden border-r border-border">
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <SectionHeader
            section="workflows"
            onCreate={() => {
              editorStore.newWorkflow();
              setSelectedPath(null);
              goTo(null);
            }}
          />
          {/* Flat list: separation by project is already defined by "Area" in the Cloud Config header. */}
          <WfList items={items} onOpen={openItem} open={identity} draft={draft} />
        </div>
      </div>

      <ResizeHandle onPointerDown={startListResize} />

      {/* Nothing open — the builder is the last column: it takes the rest of
          the width instead of reserving room for a preview of nothing. */}
      <div
        style={nothingOpen ? undefined : { width: constructorWidth }}
        className={cn(
          "flex h-full min-h-0 min-w-0 flex-col overflow-hidden",
          nothingOpen ? "flex-1" : "shrink-0",
        )}
      >
        <div className="min-h-0 flex-1 overflow-hidden">
          {nothingOpen ? (
            <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
              Pick a workflow on the left, or press + to start a new one.
            </div>
          ) : codeOnly ? (
            <CodeOnlyView source={rawSource!} />
          ) : (
            <OutlineEditor
              agents={agents}
              selectedPath={selectedPath}
              onSelect={setSelectedPath}
            />
          )}
        </div>
        {/* The workflow's own surface, so its actions belong to it — at the
            foot of the tree they act on, not in a header above it. No tree,
            no actions: Save and Delete would have nothing to work on. */}
        {!nothingOpen && (
        <div className="flex flex-col gap-2 border-t border-border p-2">
          {!codeOnly && invalidAgents > 0 && (
            <p className="text-xs text-muted-foreground">
              Workflow is invalid: {invalidAgents} {invalidAgents === 1 ? "agent" : "agents"} without a
              chosen template. Select an agent in the "Agents" column.
            </p>
          )}
          <div className="flex items-center justify-between gap-1.5">
            <ConfirmDelete
              what="workflow"
              detail={identity?.path ?? identity?.name ?? "The workflow"}
              onDelete={doDelete}
              trigger={(ask) => (
                <Button size="sm" variant="outline" onClick={ask} disabled={!identity}>
                  Delete
                </Button>
              )}
            />
            <Button
              size="sm"
              onClick={() => setSaveOpen(true)}
              disabled={codeOnly || invalidAgents > 0}
            >
              Save
            </Button>
          </div>
        </div>
        )}
      </div>

      {!nothingOpen && <ResizeHandle onPointerDown={startConstructorResize} />}

      {!nothingOpen && !codeOnly && !selAgent && !selGroup && (
        // Nothing selected — the owner's third panel rule: show what the tree compiles to right now,
        // instead of an empty column. Read-only; editing still happens in the builder / detail panels.
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-l border-border">
          <div className="shrink-0 border-b border-border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Compiles to
          </div>
          <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[11px] text-foreground">
            {compile(tree, previewEngine)}
          </pre>
        </div>
      )}

      {!codeOnly && selGroup && (
        // A phase/group header is selected — its settings take the whole panel (owner's rule), not a
        // detail alongside something else.
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-l border-border">
          <GroupDetails
            node={selGroup}
            onSetField={(patch) => editorStore.update((draft) => setGroupSettings(draft, selectedPath!, patch))}
          />
        </div>
      )}

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
                  arrow, the file path and the mode switcher end up on one
                  line. */}
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
          // A draft that just became a file belongs in the address.
          goTo({ kind: "workflow", store: nextIdentity.store, name: nextIdentity.name });
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
  // Where the panel is — area, section, open file — is the address and
  // nothing else (memory/decisions/panel-route-grammar.md). Leaving the panel
  // unmounts it and bb hands back an empty address on return; putting the
  // last one back is useRememberedRoute's job, below.
  const { areaId, section, open } = parsePanelRoute(subPath);
  const [config, setConfig] = useState<AreaConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [memory, setMemory] = useState<
    { id: string; label: string; path: string }[]
  >([]);
  // Which creation dialog is open — one of the sections' create kinds, or
  // none. "workflow" never lands here: the workflow builder creates in place,
  // without a dialog.
  const [createKind, setCreateKind] = useState<CreateKind | null>(null);
  // Enabled-skills mode — shared across the whole section (one dropdown in
  // the header, not per skill). Enabling a skill applies this mode.
  const [skillMode, setSkillMode] = useState<SkillMode>("on");

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
  // The panel's place is remembered under one constant key: the whole place
  // is the address now, so there is no second key that could change under
  // the hook and no route to put back but the last one.
  useRememberedRoute(
    PANEL_PATH,
    subPath,
    useCallback(
      (next: string) =>
        navigate.toPluginPanel(PANEL_PATH, { subPath: next, replace: true }),
      [navigate],
    ),
  );
  // Every move in the panel goes through these two. `replace` is for putting
  // a place back or dropping a file that no longer exists — not a step the
  // user took, so not a step in their history.
  const goPlace = useCallback(
    (next: PanelPlace, replace = false) =>
      navigate.toPluginPanel(PANEL_PATH, {
        subPath: panelRoute(next),
        replace,
      }),
    [navigate],
  );
  const goTo = useCallback<GoTo>(
    (next, replace = false) => goPlace({ areaId, section, open: next }, replace),
    [goPlace, areaId, section],
  );
  // Picking a section is a step of its own: Back walks sections, and a
  // section is a link. It opens with nothing selected in it.
  const openSection = (next: SectionId) =>
    goPlace({ areaId, section: next, open: null });

  // A workflow belongs to its own builder (WorkflowsView), everything else to
  // the document column — two disjoint cases of one address.
  const workflowTarget = open?.kind === "workflow" ? open : null;
  const openDoc = open !== null && open.kind !== "workflow" ? open : null;
  const selectedName = openDoc?.kind === "skill" ? openDoc.name : null;
  const selectedConnector = openDoc?.kind === "connector" ? openDoc : null;
  const selectedHook = openDoc?.kind === "hook" ? openDoc : null;
  // Open file by path (plugin README, agent, or memory file) — highlighted on match.
  const openDocPath = openDoc?.kind === "doc" ? openDoc.path : null;

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

  const [loadingSinceMs, setLoadingSinceMs] = useState<number | null>(null);
  const [loadingElapsedMs, setLoadingElapsedMs] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadingSinceMs(Date.now());
    void rpc
      .call("getConfig", { areaId })
      .then((next) => {
        if (alive) {
          setConfig(next as AreaConfig);
          setLoading(false);
          setLoadingSinceMs(null);
        }
      })
      // An RPC rejection (e.g. the output failed its own contract) left this
      // stuck on "Loading..." forever with nothing to show for it — a real
      // failure needs a real message, not silence.
      .catch((error: unknown) => {
        if (alive) {
          setNotice(error instanceof Error ? error.message : "Failed to load.");
          setLoading(false);
          setLoadingSinceMs(null);
        }
      });
    return () => {
      alive = false;
    };
    // Reset notice on area change — the old reason no longer applies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaId, rpc]);

  // Ticks while a request is in flight so the loading state can show how
  // long the current attempt has been waiting — the RPC call itself has no
  // timeout, so this is the only visible sign that it's still trying.
  useEffect(() => {
    if (loadingSinceMs === null) return;
    const tick = () => setLoadingElapsedMs(Date.now() - loadingSinceMs);
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [loadingSinceMs]);

  const loadingAreaLabel =
    areas.find((area) => area.id === areaId)?.label ?? areaId;

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
  const setSetting = (key: string, value: string | null) =>
    void rpc.call("setSetting", { areaId, key, value }).then(handleResult);
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
    // already guards against. If this exact hook is open, the address's index
    // is about to go stale; land back on the list rather than show a
    // confusing "not found" for a hook whose state just changed.
    if (
      selectedHook &&
      selectedHook.origin === hook.origin &&
      selectedHook.event === hook.event &&
      selectedHook.index === hook.index
    ) {
      goTo(null, true);
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
    // The section carries over — the same rail row exists in every area — but
    // what was open does not: that file belonged to the area being left.
    goPlace({ areaId: id, section, open: null });
  };
  // Skill, agent, plugin README, document — real files: open with bb's native opener.
  const openFile = useOpenFile(areaId, (path) => {
    // Gone to a host tab: the section keeps whatever it had open.
    if (path !== null) goTo({ kind: "doc", path });
  });
  // A memory file belongs to no section, so opening one leaves the section
  // behind — in ONE navigation. Two (clear the section, then open the file)
  // would now write the same address twice, and the second would put back the
  // section the first had just dropped.
  const openMemoryFile = useOpenFile(areaId, (path) =>
    goPlace({
      areaId,
      section: null,
      open: path === null ? null : { kind: "doc", path },
    }),
  );
  const openConnector = (origin: ConnectorOrigin, name: string) =>
    goTo({ kind: "connector", origin, name });
  const openHook = (origin: HookOrigin, index: number, event: string) =>
    goTo({ kind: "hook", origin, index, event });

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

  // Creating a hook: there's no file to open — it's an entry in the settings
  // file — so the new hook simply shows up in the list after the reload.
  const createHook = (hook: {
    event: string;
    matcher: string | null;
    command: string;
  }): Promise<string | null> =>
    rpc.call("createHook", { areaId, ...hook }).then((result) => {
      if (result.outcome === "ok") {
        setCreateKind(null);
        reload();
        return null;
      }
      return result.message ?? "Failed to create the hook.";
    });

  // A delete takes away what the third column was showing: land back on the
  // list, reload the section.
  const afterDelete = (result: WriteOutcome, what: string) => {
    if (result.outcome === "ok") {
      toast.success(`Deleted the ${what}.`);
      goTo(null, true);
    } else {
      toast.error(result.message ?? `Failed to delete the ${what}.`);
    }
    // Reload either way: on failure the list shows the file's actual state.
    reload();
  };
  const deleteSkill = (name: string) =>
    void rpc
      .call("removeSkill", { areaId, name })
      .then((result) => afterDelete(result, "skill"));
  const deleteAgent = (path: string) =>
    void rpc
      .call("removeAgent", { areaId, path })
      .then((result) => afterDelete(result, "agent"));
  const deleteHook = (hook: {
    origin: HookOrigin;
    event: string;
    matcher: string | null;
    command: string;
  }) =>
    void rpc
      .call("removeHook", { areaId, ...hook })
      .then((result) => afterDelete(result, "hook"));

  // Workflow count for the rail — from wfList for the current area (config doesn't carry it).
  const wfCount = useWfCount(rpc, areaId);

  // What's deletable in the third column: this area's own rows only — a
  // plugin README or a memory file comes through the same column.
  //
  // A skill is matched by path: clicking one opens its SKILL.md as a plain
  // document (see useOpenFile), so `openHere.kind` is "doc", not "skill" —
  // matching by name alone left even the highlight off.
  const openSkill =
    config?.skills.find(
      (skill) =>
        skill.name === selectedName ||
        (skill.path !== null && skill.path === openDocPath),
    ) ?? null;
  const openAgent =
    openDocPath === null
      ? null
      : (config?.agents.find((agent) => agent.path === openDocPath) ?? null);
  const openHookRow =
    selectedHook === null
      ? null
      : (config?.hooks.find(
          (hook) =>
            hook.origin === selectedHook.origin &&
            hook.event === selectedHook.event &&
            hook.index === selectedHook.index,
        ) ?? null);
  const docActions =
    openSkill !== null ? (
      <ConfirmDelete
        what="skill"
        detail={`The skill "${openSkill.name}" and its whole folder`}
        onDelete={() => deleteSkill(openSkill.name)}
        trigger={deleteIconTrigger("skill")}
      />
    ) : openAgent !== null ? (
      <ConfirmDelete
        what="agent"
        detail={`The agent "${openAgent.name}"`}
        onDelete={() => deleteAgent(openAgent.path)}
        trigger={deleteIconTrigger("agent")}
      />
    ) : openHookRow !== null ? (
      <ConfirmDelete
        what="hook"
        detail={`The ${openHookRow.event} hook running "${openHookRow.command}"`}
        onDelete={() =>
          deleteHook({
            origin: openHookRow.origin,
            event: openHookRow.event,
            matcher: openHookRow.matcher,
            command: openHookRow.command,
          })
        }
        trigger={deleteIconTrigger("hook")}
      />
    ) : null;

  // Rail rows: the spec table (its titles are the ones the section header
  // reads, so the two can't disagree) plus this area's counts. A null count —
  // a section without a list to count.
  const counts: Record<SectionId, number | null> = {
    hooks: config?.hooks.length ?? null,
    plugins: config?.plugins.length ?? null,
    connectors: config?.connectors.length ?? null,
    skills: config?.skills.length ?? null,
    agents: config?.agents.length ?? null,
    workflows: wfCount,
    settings: null,
  };
  const sections =
    config && !config.error
      ? SECTION_SPECS.map((spec) => ({ ...spec, count: counts[spec.id] }))
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
          className="flex shrink-0 flex-col gap-4 overflow-y-auto p-4"
        >
          {memory.length > 0 && (
            <div>
              <ColumnHeading title="Memory" />
              {memory.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  title={entry.path}
                  // A memory file supersedes the section: there should be no
                  // middle column, so the place it opens into has none.
                  onClick={() => void openMemoryFile(entry.path)}
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
            <ColumnHeading title="Sections" />
            {sections.map((item) => (
              <button
                key={item.id}
                type="button"
                // Changing the section re-renders the list and puts back
                // whatever that section had open (nothing, for a section not
                // visited yet).
                onClick={() => openSection(item.id)}
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
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 text-sm text-muted-foreground">
            <span>Connecting to {loadingAreaLabel}…</span>
            <span className="text-xs tabular-nums">
              {(loadingElapsedMs / 1000).toFixed(1)}s
            </span>
          </div>
        ) : config?.error ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-5">
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Failed to parse file {config.error.file}: {config.error.message}
            </div>
          </div>
        ) : openDoc && section === null ? (
          // Memory file: the document takes the full remaining width, no middle column.
          <div className="min-h-0 flex-1 overflow-hidden">
            <DocTab areaId={areaId} target={openDoc} goTo={goTo} />
          </div>
        ) : section === "workflows" ? (
          <WorkflowsView
            rpc={rpc}
            areaId={areaId}
            target={workflowTarget}
            goTo={goTo}
          />
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
                <SectionHeader
                  section="hooks"
                  onCreate={() => setCreateKind("hook")}
                />
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
                <SectionHeader section="plugins" />
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
                        plugin.readmePath != null &&
                          openDocPath === plugin.readmePath &&
                          "bg-accent",
                        plugin.dimmed && "opacity-60",
                      )}
                    >
                      {plugin.installPath ? (
                        <button
                          type="button"
                          onClick={() =>
                            plugin.readmePath
                              ? void openFile(plugin.readmePath)
                              : toast.error("Plugin has no README.")
                          }
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
                <SectionHeader section="connectors" />
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
                <SectionHeader
                  section="skills"
                  onCreate={() => setCreateKind("skill")}
                />
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
                        openSkill?.name === skill.name && "bg-accent",
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
                <SectionHeader
                  section="agents"
                  onCreate={() => setCreateKind("agent")}
                />
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

            {!loading && config && !config.error && section === "settings" && (
              <div>
                <SectionHeader section="settings" />
                <p className="mb-3 text-xs text-muted-foreground">
                  The rest of settings.json — everything not already covered
                  by Hooks, Plugins, Connectors, Skills, or Agents.
                </p>

                <div className={cn("mb-4", config.toolSearch.dimmed && "opacity-60")}>
                  <div className="text-sm font-medium">Tool search</div>
                  <p className="mb-2 text-xs text-muted-foreground">
                    Plugin and MCP tool schemas aren't all loaded into context
                    at once — only the list of names is visible, and the full
                    schema is fetched on demand when a tool is needed. Saves
                    context, especially with many MCP servers. "Always" —
                    defer loading always; "Automatic" — only when there are
                    many tools; off — load all schemas up front.
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

                <div className="space-y-1">
                  {config.settings.map((setting) => (
                    <SettingField
                      key={setting.key}
                      setting={setting}
                      onChange={(value) => setSetting(setting.key, value)}
                    />
                  ))}
                </div>
              </div>
            )}
              </div>
            </div>

            {/* Divider between the middle column and the document — takes the rest of the width. */}
            <ResizeHandle onPointerDown={startMidResize} />
            <div className="min-h-0 flex-1 overflow-hidden">
              {openDoc ? (
                <DocTab
                  areaId={areaId}
                  target={openDoc}
                  goTo={goTo}
                  actions={docActions}
                />
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
      <HookCreateDialog
        open={createKind === "hook"}
        onClose={() => setCreateKind(null)}
        onCreate={createHook}
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
