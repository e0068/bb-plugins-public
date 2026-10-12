// react/workflow-editor.tsx — the builder of one open workflow: the tree, the detail of what is picked in
// it (a group's settings, or an agent: its template picker, file and step settings) and, when nothing is
// picked, what the tree compiles to. A file the builder can't read as a tree shows as read-only code with
// the reason. No list of workflows and no save dialog — those, and the Save/Delete buttons in `footer`,
// belong to the consumer (Claude Config's Workflows section, Flow's file opener), so the package needs no
// component library: plain elements with the design system's Tailwind tokens.
import { useEffect, useState, type ReactNode } from "react";
import { HorizontalResizeHandle, ResizeHandle, useResizableHeight, useResizableWidth } from "../../resizable-pane/react";
import { compile, type Agent, type Container, type Engine, type Phase, type Step, type Unrecognized } from "../model";
import { applyTemplate, nodeAt, setAgentField, setGroupSettings, type OutlinePath } from "../outline-ops";
import { agentsMissingTemplate } from "../validity";
import { useEditorSnapshot, useEditorStore } from "./context";
import { AgentDetails, GroupDetails, OutlineEditor, type AgentOption, type ProviderCatalogEntry } from "./outline-editor";

/** Settings beside the tree keep a readable width: in a narrow tab the row scrolls sideways instead of squeezing them. */
const DETAIL_MIN = { minWidth: 280 } as const;

/** Which of the builder's columns stand on screen: side by side, or one at a time on a narrow screen. */
export type EditorColumns = "all" | "builder" | "detail";

const AGENT_SCOPE_LABEL: Record<NonNullable<AgentOption["scope"]>, string> = {
  user: "personal",
  project: "project",
  plugin: "plugin",
  builtin: "builtin",
};

export const UNRECOGNIZED_TEXT: Record<Unrecognized, string> = {
  "hand-written": "No builder mark — written by hand.",
  edited: "Edited by hand after saving — the builder can't rebuild it.",
};

/**
 * A file the builder can't read as a tree: its source under the reason — read-only, or edited as text when `onChange` is
 * given (the consumer saves it as is).
 */
export function CodeOnlyView({ source, reason, onChange }: { source: string; reason: Unrecognized; onChange?: (source: string) => void }) {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
        {UNRECOGNIZED_TEXT[reason]} {onChange ? "Edit the code here." : "Read-only; edit the .js file directly."}
      </div>
      {onChange ? (
        <textarea
          aria-label="workflow source"
          value={source}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-0 flex-1 resize-none bg-transparent p-4 font-mono text-xs text-foreground outline-none"
        />
      ) : (
        <pre className="flex-1 overflow-auto p-4 font-mono text-xs text-foreground" aria-label="workflow source">
          {source}
        </pre>
      )}
    </div>
  );
}

export interface WorkflowEditorProps {
  agents: AgentOption[];
  providerCatalog: ProviderCatalogEntry[];
  /** The engine the "Compiles to" column renders for. */
  previewEngine: Engine;
  columns: EditorColumns;
  /** The picked node — lifted so the consumer can tell "a detail is open" for its own narrow-screen ladder. */
  selectedPath: OutlinePath | null;
  onSelect: (path: OutlinePath | null) => void;
  /** Save/Delete of the open workflow, at the foot of the tree they act on. */
  footer?: ReactNode;
  /** Above the tree — the consumer's way back to its list on a narrow screen. */
  header?: ReactNode;
  /** Shown instead of the builder while nothing is open. */
  empty?: ReactNode;
  /** The way back to the builder on a narrow screen, drawn by the consumer. */
  renderBack?: (label: string, onClick: () => void) => ReactNode;
  /** The picked agent's template file above its settings; `back` returns to the agent list. */
  agentFile?: (path: string, back: ReactNode) => ReactNode;
  /** localStorage prefix for the builder's column width and the agent file's height. */
  storageKey: string;
  /** A file the builder can't read as a tree is edited as code instead of shown read-only. */
  editableCode?: boolean;
}

export function WorkflowEditor({
  agents,
  providerCatalog,
  previewEngine,
  columns,
  selectedPath,
  onSelect,
  footer,
  header,
  empty,
  renderBack,
  agentFile,
  storageKey,
  editableCode = false,
}: WorkflowEditorProps) {
  const store = useEditorStore();
  const { tree, identity, rawSource, reason, draft } = useEditorSnapshot();
  const codeOnly = rawSource !== null;
  // Nothing open at all: no file, no new workflow started.
  const nothingOpen = identity === null && !draft;
  // Picker list or the picked agent's detail, toggled by clicking an agent / the "Back" button.
  const [pickerOpen, setPickerOpen] = useState(true);

  const node: Phase | Step | null = selectedPath && !codeOnly ? nodeAt(tree, selectedPath) : null;
  const selAgent: Agent | null = node && "type" in node && node.type === "agent" ? node : null;
  // A Phase has no `type` at all; a Container's is "container" — either owns the node settings.
  const selGroup: Phase | Container | null = node && (!("type" in node) || node.type === "container") ? node : null;
  const selAgentPath: string | null = selAgent ? agents.find((a) => a.value === selAgent.agentType)?.path ?? null : null;

  // A newly picked step opens its detail if a template is already assigned, otherwise the picker. Only
  // selectedPath is a dependency: choosing a template must not roll the picker back.
  useEffect(() => {
    setPickerOpen(!selAgent || selAgent.agentType.trim() === "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPath]);

  const { width: builderWidth, startResize: startBuilderResize } = useResizableWidth({
    initial: 360,
    min: 220,
    max: 760,
    side: "left",
    storageKey: `${storageKey}-constructor-width-v2`,
  });
  const { height: agentFileHeight, startResize: startAgentFileResize } = useResizableHeight({
    initial: 280,
    min: 120,
    max: 640,
    storageKey: `${storageKey}-agent-file-height`,
  });

  // An agent is valid only with a template chosen; while one lacks it, saving is blocked by the consumer.
  const invalidAgents = agentsMissingTemplate(tree);
  const wide = columns === "all";
  const back = (label: string, onClick: () => void) => (columns !== "all" && renderBack ? renderBack(label, onClick) : null);
  const toAgents = (
    <button type="button" onClick={() => setPickerOpen(true)} className="mdo-back" aria-label="Back to the agent list">
      ←
    </button>
  );

  return (
    <>
      {(wide || columns === "builder") && (
        <div
          style={nothingOpen || !wide ? undefined : { width: builderWidth }}
          className={["flex h-full min-h-0 min-w-0 flex-col overflow-hidden", nothingOpen || !wide ? "flex-1" : "shrink-0"].join(" ")}
        >
          {header}
          <div className="min-h-0 flex-1 overflow-hidden">
            {nothingOpen ? (
              empty
            ) : codeOnly ? (
              <CodeOnlyView source={rawSource} reason={reason ?? "hand-written"} onChange={editableCode ? store.setRawSource : undefined} />
            ) : (
              <OutlineEditor agents={agents} selectedPath={selectedPath} onSelect={onSelect} />
            )}
          </div>
          {!nothingOpen && (
            <div className="flex flex-col gap-2 border-t border-border p-2">
              {!codeOnly && invalidAgents > 0 && (
                <p className="text-xs text-muted-foreground">
                  Workflow is invalid: {invalidAgents} {invalidAgents === 1 ? "agent" : "agents"} without a chosen template. Select an agent in the
                  "Agents" column.
                </p>
              )}
              {footer}
            </div>
          )}
        </div>
      )}

      {!nothingOpen && wide && <ResizeHandle onPointerDown={startBuilderResize} />}

      {!nothingOpen && !codeOnly && !selAgent && !selGroup && wide && (
        // Nothing picked — what the tree compiles to right now, read-only.
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-l border-border">
          <div className="shrink-0 border-b border-border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Compiles to</div>
          <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[11px] text-foreground">{compile(tree, previewEngine)}</pre>
        </div>
      )}

      {selGroup && (wide || columns === "detail") && (
        <div style={DETAIL_MIN} className="flex h-full min-h-0 flex-1 flex-col overflow-hidden border-l border-border">
          {back("Workflow", () => onSelect(null))}
          <GroupDetails node={selGroup} onSetField={(patch) => store.update((d) => setGroupSettings(d, selectedPath!, patch))} />
        </div>
      )}

      {selAgent && (wide || columns === "detail") && (
        <div style={DETAIL_MIN} className="flex h-full min-h-0 flex-1 flex-col overflow-hidden border-l border-border">
          {back("Workflow", () => onSelect(null))}
          {pickerOpen ? (
            <div className="flex h-full flex-col gap-0.5 overflow-y-auto p-2">
              <div className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Agents</div>
              {agents.map((a) => (
                <button
                  key={a.path ?? a.value}
                  type="button"
                  onClick={() => {
                    store.update((d) => applyTemplate(d, selectedPath!, a.value, { model: a.model, effort: a.effort, provider: a.provider }));
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
              {/* Without a template file there is no file header to hold the way back — it stands alone. */}
              {!(selAgentPath && agentFile) && (
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
              {selAgentPath && agentFile && (
                <>
                  <div style={{ height: agentFileHeight }} className="shrink-0 overflow-hidden">
                    {agentFile(selAgentPath, toAgents)}
                  </div>
                  <HorizontalResizeHandle onPointerDown={startAgentFileResize} />
                </>
              )}
              <div className="min-h-0 flex-1 overflow-hidden">
                <AgentDetails
                  agent={selAgent}
                  agents={agents}
                  providerCatalog={providerCatalog}
                  onSetField={(patch) => store.update((d) => setAgentField(d, selectedPath!, patch))}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
