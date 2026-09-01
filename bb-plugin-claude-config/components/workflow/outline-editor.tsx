// components/workflow/outline-editor.tsx — the workflow editor as a nested outline (phase → step, a
// step being an agent or a group). Wired to the real editorStore + outline-ops.ts: every structural
// edit runs through editorStore.update((draft) => outlineOps.xxx(…)); markup/Tailwind classes are the
// design's.
//
// Selection (which agent's detail panel is open) is lifted to the caller: this component takes
// `selectedPath`/`onSelect` as props instead of owning local useState, so the parent can render the
// AgentDetails panel itself (e.g. as a separate layout column).
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { EFFORTS, MODELS, type Agent, type Phase, type Step, type Tree } from "../../src/workflow/workflow-model";
import {
  addPhase,
  addStep,
  removeNode,
  renameNode,
  toggleMode,
  type OutlinePath,
} from "../../src/workflow/outline-ops";
import { editorStore, type EditorSnapshot } from "../../src/workflow/store";
import { MarkdownEditor } from "../../packages/md-editor/react";

// A discovered agent (from the `agents` RPC): its agentType value, frontmatter-derived
// model/effort/provider, and — for the Save/Override decision and the tools written back to the
// agent's .md — its tools list and which agents/ directory it lives in.
export interface AgentOption {
  value: string;
  model: string;
  effort: string;
  provider: string;
  description?: string;
  path?: string;
  tools?: string[];
  scope?: "user" | "project" | "plugin";
}
export interface ProviderCatalogEntry {
  id: string;
  name: string;
  models: { id: string; efforts: string[] }[];
}
const isPlaceholder = (s: string) => s.trim() === "";
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s); // provider/model/effort display
const PH = "text-foreground/60"; // placeholders and default values: foreground at 0.6 opacity
const CELL = "flex h-[30px] items-center rounded px-2 text-[11px] leading-none";
const SELECT_CLS =
  "flex h-8 w-full items-center rounded-md border border-border bg-transparent px-2 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60";

function samePath(a: OutlinePath | null, b: OutlinePath): boolean {
  return !!a && a.length === b.length && a.every((v, i) => v === b[i]);
}

// Prepend an empty "default" option unless it's already there.
function withBlank(options: string[]): string[] {
  return options[0] === "" ? options : ["", ...options];
}

// ---- primitives ----

function ModeGlyph({ mode, onToggle }: { mode: string; onToggle: () => void }) {
  const parallel = mode === "parallel";
  return (
    <button
      type="button"
      aria-label={parallel ? "parallel — click for sequential" : "sequential — click for parallel"}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className="flex h-4 w-4 shrink-0 items-center justify-center text-[13px] leading-none text-muted-foreground transition hover:text-foreground"
    >
      {parallel ? "⇉" : "↓"}
    </button>
  );
}

function Connector({ parentMode }: { parentMode: string }) {
  return (
    <span className="flex h-[30px] w-4 shrink-0 items-center justify-center text-[12px] text-muted-foreground">
      {parentMode === "parallel" ? "→" : "↓"}
    </span>
  );
}

function XCell({ label, bg = "bg-muted", onDelete }: { label: string; bg?: string; onDelete: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onDelete();
      }}
      className={`flex h-[30px] w-[28px] shrink-0 items-center justify-center rounded ${bg} text-[13px] text-muted-foreground transition hover:text-destructive`}
    >
      ✕
    </button>
  );
}

function Dot({ on }: { on: boolean }) {
  return (
    <span className={`flex h-3 w-3 shrink-0 items-center justify-center rounded-full border ${on ? "border-foreground" : "border-muted-foreground"}`}>
      {on && <span className="h-1.5 w-1.5 rounded-full bg-foreground" />}
    </span>
  );
}

// Inline-renameable title; the mode glyph sits left and is outside the rename hit target. `value` empty
// renders `placeholderText` dimmed (and the rename input still starts truly empty).
function TitleCell({
  value,
  placeholderText,
  strong,
  glyph,
  renameLabel,
  onRename,
}: {
  value: string;
  placeholderText?: string;
  strong?: boolean;
  glyph: ReactNode;
  renameLabel?: string;
  onRename: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const empty = isPlaceholder(value);
  return (
    <div className={`${CELL} min-w-0 flex-1 gap-2 bg-muted`}>
      {glyph}
      {editing ? (
        <input
          autoFocus
          aria-label={renameLabel}
          defaultValue={value}
          onBlur={(e) => {
            onRename(e.target.value);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setEditing(false);
          }}
          onClick={(e) => e.stopPropagation()}
          className="min-w-0 flex-1 bg-transparent text-[11px] leading-none text-foreground outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={`min-w-0 flex-1 truncate text-left ${empty ? PH : strong ? "font-medium text-foreground" : "text-foreground"}`}
        >
          {empty ? (placeholderText ?? "") : value}
        </button>
      )}
    </div>
  );
}

// ---- provider/model/effort options for the detail panel's provider · model · effort selects ----
//
// A "known" agent (agentType matches a discovered AgentOption) pins the provider — mirrors
// ui/tree-editor.tsx's AgentColumn exactly, including the sync effect that pushes the pin into the
// agent's own `provider` field so a saved/compiled agent carries it.
function useModelOptions(agent: Agent, chosen: AgentOption | null, providerCatalog: ProviderCatalogEntry[], onChange: (patch: Partial<Agent>) => void) {
  const pinnedProviderId = chosen?.provider || "";

  useEffect(() => {
    if (pinnedProviderId && agent.provider !== pinnedProviderId) onChange({ provider: pinnedProviderId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinnedProviderId, agent.provider]);

  const effectiveProviderId = pinnedProviderId || agent.provider;
  const effectiveProvider = providerCatalog.find((p) => p.id === effectiveProviderId) ?? null;

  const rawModelOptions = effectiveProvider ? effectiveProvider.models.map((m) => m.id) : MODELS;
  const modelOptions = withBlank(agent.model && !rawModelOptions.includes(agent.model) ? [agent.model, ...rawModelOptions] : rawModelOptions);

  const selectedModelEntry = effectiveProvider?.models.find((m) => m.id === agent.model) ?? null;
  const effortOptions = selectedModelEntry ? withBlank(selectedModelEntry.efforts) : EFFORTS;

  const providerOptions = withBlank(providerCatalog.map((p) => p.id));

  return { pinnedProviderId, providerOptions, modelOptions, effortOptions };
}

// ---- rows ----

// The row shows ONE field — the chosen agent: name left-aligned and truncated. The grey badges on the
// right show model/effort ONLY when the step overrides the template's own values (a bare template runs
// on its own model/effort, so nothing is shown); editing them lives in the detail panel.
function AgentRow({
  agent,
  selected,
  agents,
  onSelect,
  onDelete,
}: {
  agent: Agent;
  selected: boolean;
  agents: AgentOption[];
  onSelect: () => void;
  onDelete: () => void;
}) {
  const chosen = agents.find((a) => a.value === agent.agentType) ?? null;
  const bg = selected ? "bg-background" : "bg-muted";
  const displayName = agent.agentType.trim() || agent.label.trim();
  const dotOn = agent.agentType.trim() !== "";
  const modelOverride = agent.model !== "" && agent.model !== (chosen?.model ?? "");
  const effortOverride = agent.effort !== "" && agent.effort !== (chosen?.effort ?? "");

  return (
    <div role="button" tabIndex={0} onClick={onSelect} className="flex flex-1 cursor-pointer items-center gap-1.5 rounded">
      <div className={`${CELL} min-w-0 flex-1 gap-2 ${bg}`}>
        <Dot on={dotOn} />
        <span className={`min-w-0 flex-1 truncate ${isPlaceholder(displayName) ? PH : "text-foreground"}`}>
          {isPlaceholder(displayName) ? "Agent" : displayName}
        </span>
        {(modelOverride || effortOverride) && (
          <div className={`flex shrink-0 items-center gap-1.5 ${PH}`}>
            {modelOverride && <span>{cap(agent.model)}</span>}
            {effortOverride && <span>{cap(agent.effort)}</span>}
          </div>
        )}
      </div>
      <XCell label="delete step" bg={bg} onDelete={onDelete} />
    </div>
  );
}

function AddRow({ onAdd }: { onAdd: (kind: "agent" | "group") => void }) {
  const cell = `${CELL} flex-1 justify-center bg-muted text-muted-foreground transition hover:text-foreground`;
  return (
    <div className="flex items-center gap-1.5">
      <span className="flex h-[30px] w-4 shrink-0 items-center justify-center text-[12px] text-muted-foreground">+</span>
      <div className="flex flex-1 gap-1.5">
        <button type="button" className={cell} onClick={() => onAdd("agent")}>
          Add Agent
        </button>
        <button type="button" className={cell} onClick={() => onAdd("group")}>
          Add Group
        </button>
      </div>
    </div>
  );
}

interface RowsCallbacks {
  agents: AgentOption[];
  onSelect: (path: OutlinePath) => void;
  onToggleMode: (path: OutlinePath) => void;
  onRename: (path: OutlinePath, title: string) => void;
  onRemove: (path: OutlinePath) => void;
  onAdd: (base: OutlinePath, kind: "agent" | "group") => void;
}

function Rows({
  steps,
  parentMode,
  base,
  selected,
  ...cb
}: RowsCallbacks & { steps: Step[]; parentMode: string; base: OutlinePath; selected: OutlinePath | null }) {
  return (
    <div className="space-y-1.5">
      {steps.map((step, i) => {
        const path = [...base, i];
        return (
          <div key={i}>
            <div className="flex items-center gap-1.5">
              <Connector parentMode={parentMode} />
              {step.type === "agent" ? (
                <AgentRow
                  agent={step}
                  selected={samePath(selected, path)}
                  agents={cb.agents}
                  onSelect={() => cb.onSelect(path)}
                  onDelete={() => cb.onRemove(path)}
                />
              ) : (
                <>
                  <TitleCell
                    value={step.title}
                    placeholderText="Group"
                    renameLabel="group title"
                    glyph={<ModeGlyph mode={step.mode} onToggle={() => cb.onToggleMode(path)} />}
                    onRename={(v) => cb.onRename(path, v)}
                  />
                  <XCell label="delete group" onDelete={() => cb.onRemove(path)} />
                </>
              )}
            </div>
            {step.type === "container" && (
              <div className="mt-1.5 pl-5">
                <Rows steps={step.steps} parentMode={step.mode} base={path} selected={selected} {...cb} />
                <div className="mt-1.5">
                  <AddRow onAdd={(kind) => cb.onAdd(path, kind)} />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PhaseBlock({
  phase,
  index,
  selected,
  ...cb
}: RowsCallbacks & { phase: Phase; index: number; selected: OutlinePath | null }) {
  return (
    <div className="space-y-1.5 rounded-md border border-border bg-muted/40 p-1">
      <div className="flex items-center gap-1.5">
        <TitleCell
          value={phase.title}
          placeholderText="Phase"
          strong
          renameLabel="phase title"
          glyph={<ModeGlyph mode={phase.mode} onToggle={() => cb.onToggleMode([index])} />}
          onRename={(v) => cb.onRename([index], v)}
        />
        <XCell label={`delete ${phase.title || "phase"}`} onDelete={() => cb.onRemove([index])} />
      </div>
      <Rows steps={phase.steps} parentMode={phase.mode} base={[index]} selected={selected} {...cb} />
      <AddRow onAdd={(kind) => cb.onAdd([index], kind)} />
    </div>
  );
}

// The step's per-workflow overrides: model · effort, instructions, result format. Name and template
// are gone — the template IS the agent (picked in the Agents column), and everything edited here is
// saved into the workflow step (editorStore), never written back to the agent's .md. The provider is
// pinned by the template and shown disabled.
export function AgentDetails({
  agent,
  agents,
  providerCatalog,
  onSetField,
}: {
  agent: Agent;
  agents: AgentOption[];
  providerCatalog: ProviderCatalogEntry[];
  onSetField: (patch: Partial<Agent>) => void;
}) {
  const chosen = agents.find((a) => a.value === agent.agentType) ?? null;
  const { pinnedProviderId, providerOptions, modelOptions, effortOptions } = useModelOptions(agent, chosen, providerCatalog, onSetField);
  const locked = pinnedProviderId !== "";

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <section className="space-y-1.5">
          <span className="text-xs text-muted-foreground">Model{locked && " · provider from template"}</span>
          <div className="grid grid-cols-3 gap-2">
            <select
              aria-label="agent detail provider"
              disabled={locked}
              value={locked ? pinnedProviderId : agent.provider}
              onChange={(e) => onSetField({ provider: e.target.value })}
              className={SELECT_CLS}
            >
              {providerOptions.map((o) => (
                <option key={o || "d"} value={o}>
                  {o === "" ? "Default" : cap(o)}
                </option>
              ))}
            </select>
            <select aria-label="agent detail model" value={agent.model} onChange={(e) => onSetField({ model: e.target.value })} className={SELECT_CLS}>
              {modelOptions.map((o) => (
                <option key={o || "d"} value={o}>
                  {o === "" ? "Default" : cap(o)}
                </option>
              ))}
            </select>
            <select aria-label="agent detail effort" value={agent.effort} onChange={(e) => onSetField({ effort: e.target.value })} className={SELECT_CLS}>
              {effortOptions.map((o) => (
                <option key={o || "d"} value={o}>
                  {o === "" ? "Default" : cap(o)}
                </option>
              ))}
            </select>
          </div>
        </section>

        <section className="space-y-1.5">
          <span className="text-xs text-muted-foreground">Instructions</span>
          <div className="rounded-md border border-border">
            <MarkdownEditor editable value={agent.prompt} onChange={(v) => onSetField({ prompt: v })} flush />
          </div>
        </section>
        <section className="space-y-1.5">
          <span className="text-xs text-muted-foreground">Result format (JSON schema, optional)</span>
          <textarea
            aria-label="agent detail schema"
            value={agent.schema}
            onChange={(e) => onSetField({ schema: e.target.value })}
            placeholder='{ "type": "object", "required": ["verdict"] }'
            className="min-h-24 w-full rounded-md border border-border bg-transparent p-2 font-mono text-[11px] text-foreground outline-none placeholder:text-foreground/60 focus-visible:ring-1 focus-visible:ring-ring"
          />
        </section>
      </div>
    </div>
  );
}

// ---- header (Name/Description) ----

function Header({ tree }: { tree: Tree }) {
  return (
    <div className="space-y-1.5 pb-1">
      <input
        aria-label="outline workflow name"
        value={tree.name}
        onChange={(e) => editorStore.setName(e.target.value)}
        placeholder="workflow-name"
        className="w-full bg-transparent text-lg font-semibold text-foreground outline-none placeholder:text-foreground/60"
      />
      <input
        aria-label="outline workflow description"
        value={tree.description}
        onChange={(e) => editorStore.setDescription(e.target.value)}
        placeholder="What the workflow does"
        className="w-full bg-transparent text-xs text-muted-foreground outline-none placeholder:text-foreground/60"
      />
    </div>
  );
}

const useEditor = () => useSyncExternalStore(editorStore.subscribe, editorStore.getSnapshot, editorStore.getSnapshot) as EditorSnapshot;

// ---- the outline panel ----

export function OutlineEditor({
  agents,
  selectedPath,
  onSelect,
}: {
  agents: AgentOption[];
  selectedPath: OutlinePath | null;
  onSelect: (path: OutlinePath | null) => void;
}) {
  const { tree } = useEditor();

  const remove = (path: OutlinePath) => {
    editorStore.update((draft) => removeNode(draft, path));
    if (samePath(selectedPath, path)) onSelect(null);
  };
  const add = (base: OutlinePath, kind: "agent" | "group") => editorStore.update((draft) => addStep(draft, base, kind));
  const toggle = (path: OutlinePath) => editorStore.update((draft) => toggleMode(draft, path));
  const rename = (path: OutlinePath, title: string) => editorStore.update((draft) => renameNode(draft, path, title));

  const rowsCallbacks: RowsCallbacks = {
    agents,
    onSelect,
    onToggleMode: toggle,
    onRename: rename,
    onRemove: remove,
    onAdd: add,
  };

  return (
    <div className="flex h-full min-h-0 flex-1">
      <div className="min-h-0 flex-1 overflow-auto bg-background p-4">
        <div className="mx-auto max-w-[520px] space-y-2.5">
          <Header tree={tree} />
          {tree.phases.map((phase, i) => (
            <PhaseBlock key={i} phase={phase} index={i} selected={selectedPath} {...rowsCallbacks} />
          ))}
          <button
            type="button"
            onClick={() => editorStore.update((draft) => addPhase(draft))}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-muted/40 py-2 text-[11px] text-muted-foreground hover:text-foreground"
          >
            + Add Phase
          </button>
        </div>
      </div>
    </div>
  );
}
