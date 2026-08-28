// ui/outline-editor.tsx — the workflow editor as a nested outline (phase → step, a step being an
// agent or a group). Wired to the real editorStore + outline-ops.ts: every structural edit runs
// through editorStore.update((draft) => outlineOps.xxx(…)); markup/Tailwind classes are the design's.
//
// Selection (which agent's detail panel is open) is UI-only and lives in local useState — it is not
// part of the saved document, unlike the tree itself.
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { toast } from "sonner";
import { EFFORTS, MODELS, type Agent, type Phase, type Step, type Tree } from "../workflow-model";
import {
  addPhase,
  addStep,
  applyTemplate,
  nodeAt,
  removeNode,
  renameNode,
  setAgentField,
  toggleMode,
  type OutlinePath,
} from "../outline-ops";
import { editorStore, type EditorSnapshot } from "../store";
import { MarkdownEditor } from "../packages/md-editor/react";

// A discovered agent (from the `agents` RPC): its agentType value, frontmatter-derived
// model/effort/provider, and — for the outline's read-only Tools display and Save/Override
// decision — its tools list and which agents/ directory it lives in.
interface AgentOption {
  value: string;
  model: string;
  effort: string;
  provider: string;
  description?: string;
  path?: string;
  tools?: string[];
  scope?: "user" | "project" | "plugin";
}
interface ProviderCatalogEntry {
  id: string;
  name: string;
  models: { id: string; efforts: string[] }[];
}
interface WriteAgentInput {
  scope: "user" | "project";
  name: string;
  content: string;
  overwrite: boolean;
}
interface WriteAgentResult {
  path: string;
}

const TOOLS = ["Read", "Write", "Edit", "Bash", "Grep", "Glob", "Task", "WebFetch"];
const KEBAB_RE = /^[a-z0-9][a-z0-9-]*$/;

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

function kebab(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "-");
}

// The .md an agent's Save/Override buttons write: frontmatter (name, then model/tools when non-empty)
// followed by the instructions verbatim as the body.
function composeAgentMd(name: string, model: string, tools: string[], instructions: string): string {
  const lines = ["---", `name: ${name}`];
  if (model) lines.push(`model: ${model}`);
  if (tools.length) lines.push(`tools: ${tools.join(", ")}`);
  lines.push("---", instructions);
  return lines.join("\n") + "\n";
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

// One column inside the model picker's three-column dropdown.
function PickerColumn({
  title,
  value,
  options,
  locked,
  onPick,
}: {
  title: string;
  value: string;
  options: string[];
  locked?: boolean;
  onPick: (v: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col border-r border-border last:border-r-0">
      <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="max-h-52 overflow-y-auto pb-1">
        {options.map((o) => (
          <button
            key={o || "default"}
            type="button"
            disabled={locked}
            onClick={(e) => {
              e.stopPropagation();
              onPick(o);
            }}
            className={`block w-full truncate px-2 py-1 text-left text-[11px] hover:bg-muted disabled:hover:bg-transparent disabled:opacity-60 ${
              o === value ? "bg-muted text-foreground" : o === "" ? PH : "text-muted-foreground"
            }`}
          >
            {o === "" ? "Default" : cap(o)}
          </button>
        ))}
      </div>
    </div>
  );
}

// The Model control — ONE cell whose dropdown is three columns: provider · model · effort. Options and
// the provider lock come from useModelOptions below, so the row and the detail panel agree.
function ModelPicker({
  provider,
  model,
  effort,
  width,
  bg = "bg-muted",
  providerLocked,
  providerOptions,
  modelOptions,
  effortOptions,
  onChange,
}: {
  provider: string;
  model: string;
  effort: string;
  width: string;
  bg?: string;
  providerLocked: boolean;
  providerOptions: string[];
  modelOptions: string[];
  effortOptions: string[];
  onChange: (patch: Partial<Agent>) => void;
}) {
  const [open, setOpen] = useState(false);
  const filled = provider !== "" || model !== "" || effort !== "";
  return (
    <div
      className={`relative ${width} shrink-0`}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={`${CELL} w-full justify-between gap-1 ${bg} ${filled ? "text-foreground" : PH}`}
      >
        <span className="truncate">{model ? cap(model) : "Model"}</span>
        {effort && <span className={`shrink-0 ${PH}`}>{cap(effort)}</span>}
      </button>
      {open && (
        <div
          className="absolute right-0 top-full z-30 mt-1 flex w-[300px] rounded-md border border-border bg-popover shadow-md"
          onClick={(e) => e.stopPropagation()}
        >
          <PickerColumn title="Provider" value={provider} options={providerOptions} locked={providerLocked} onPick={(v) => onChange({ provider: v })} />
          <PickerColumn title="Model" value={model} options={modelOptions} onPick={(v) => onChange({ model: v })} />
          <PickerColumn title="Effort" value={effort} options={effortOptions} onPick={(v) => onChange({ effort: v })} />
        </div>
      )}
    </div>
  );
}

// Read-only Tools cell for the row (both a templated agent's and a custom agent's tools are edited only
// in the detail panel — never at the compact row).
function ToolsCell({ tools, bg = "bg-muted" }: { tools: string[]; bg?: string }) {
  const summary = tools.length === 0 ? "Tools" : tools.length <= 2 ? tools.join(", ") : `${tools[0]} +${tools.length - 1}`;
  return (
    <div className={`${CELL} w-[84px] shrink-0 justify-center ${bg} ${tools.length ? "text-foreground" : PH}`}>
      <span className="truncate">{summary}</span>
    </div>
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

// Cap the suggestion list so an empty filter over a large agent catalog doesn't render hundreds of rows.
const AGENT_SUGGESTION_LIMIT = 50;

// Free-text "Template" combobox: the input stays bound to agent.agentType, a suggestion list opens on
// focus, and picking one (not free typing) fires onSelect so the caller can prefill model/effort/tools.
function AgentTypeCombobox({
  value,
  options,
  onChange,
  onSelect,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  onSelect: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const needle = value.trim().toLowerCase();
  const matches = (needle ? options.filter((o) => o.toLowerCase().includes(needle)) : options).slice(0, AGENT_SUGGESTION_LIMIT);
  return (
    <div className="relative">
      <input
        aria-label="agent template"
        placeholder="— none (custom) —"
        className="flex h-8 w-full rounded-md border border-border bg-transparent px-3 text-sm text-foreground outline-none placeholder:text-foreground/60 focus-visible:ring-1 focus-visible:ring-ring"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      />
      {open && matches.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-md border border-border bg-popover shadow-md">
          {matches.map((a) => (
            <button
              key={a}
              type="button"
              role="option"
              className="block w-full truncate px-3 py-1.5 text-left text-sm text-foreground hover:bg-muted"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(a);
                onSelect(a);
                setOpen(false);
              }}
            >
              {a}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- provider/model/effort options, shared by the row's ModelPicker and the detail panel's selects ----
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

function AgentRow({
  agent,
  selected,
  agents,
  providerCatalog,
  onSelect,
  onSetField,
  onDelete,
}: {
  agent: Agent;
  selected: boolean;
  agents: AgentOption[];
  providerCatalog: ProviderCatalogEntry[];
  onSelect: () => void;
  onSetField: (patch: Partial<Agent>) => void;
  onDelete: () => void;
}) {
  const chosen = agents.find((a) => a.value === agent.agentType) ?? null;
  const rowTools = chosen ? chosen.tools ?? [] : agent.tools;
  const bg = selected ? "bg-background" : "bg-muted";
  const displayName = agent.label.trim() || agent.agentType.trim();
  const dotOn = agent.agentType.trim() !== "" || agent.prompt.trim() !== "" || agent.schema.trim() !== "";
  const { pinnedProviderId, providerOptions, modelOptions, effortOptions } = useModelOptions(agent, chosen, providerCatalog, onSetField);

  return (
    <div role="button" tabIndex={0} onClick={onSelect} className="flex flex-1 cursor-pointer items-center gap-1.5 rounded">
      <div className={`${CELL} min-w-0 flex-1 gap-2 ${bg}`}>
        <Dot on={dotOn} />
        <span className={`truncate ${isPlaceholder(displayName) ? PH : "text-foreground"}`}>{isPlaceholder(displayName) ? "Agent" : displayName}</span>
      </div>
      <ModelPicker
        provider={agent.provider}
        model={agent.model}
        effort={agent.effort}
        width="w-[124px]"
        bg={bg}
        providerLocked={pinnedProviderId !== ""}
        providerOptions={providerOptions}
        modelOptions={modelOptions}
        effortOptions={effortOptions}
        onChange={onSetField}
      />
      <ToolsCell tools={rowTools} bg={bg} />
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
  providerCatalog: ProviderCatalogEntry[];
  onSelect: (path: OutlinePath) => void;
  onToggleMode: (path: OutlinePath) => void;
  onRename: (path: OutlinePath, title: string) => void;
  onSetField: (path: OutlinePath, patch: Partial<Agent>) => void;
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
                  providerCatalog={cb.providerCatalog}
                  onSelect={() => cb.onSelect(path)}
                  onSetField={(patch) => cb.onSetField(path, patch)}
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

// A templated agent and a hand-configured one render the same form (Name · Template · Model · Tools ·
// Instructions · Result format). The bottom button reflects whether editing this agent should write back
// to its existing .md (Override), mint a new one (Save as new agent), or neither (Saved, disabled).
function AgentDetails({
  agent,
  agents,
  providerCatalog,
  writeAgent,
  onSetField,
  onApplyTemplate,
  onClose,
}: {
  agent: Agent;
  agents: AgentOption[];
  providerCatalog: ProviderCatalogEntry[];
  writeAgent: (input: WriteAgentInput) => Promise<WriteAgentResult>;
  onSetField: (patch: Partial<Agent>) => void;
  onApplyTemplate: (agentType: string, info: { model: string; effort: string; provider: string }) => void;
  onClose: () => void;
}) {
  const [touched, setTouched] = useState(false);
  const chosen = agents.find((a) => a.value === agent.agentType) ?? null;
  const { pinnedProviderId, providerOptions, modelOptions, effortOptions } = useModelOptions(agent, chosen, providerCatalog, onSetField);
  const locked = pinnedProviderId !== "";
  const tools = chosen ? chosen.tools ?? [] : agent.tools;

  const setField = (patch: Partial<Agent>) => {
    setTouched(true);
    onSetField(patch);
  };

  const selectTemplate = (value: string) => {
    const info = agents.find((a) => a.value === value);
    if (info) onApplyTemplate(value, { model: info.model, effort: info.effort, provider: info.provider });
    else setField({ agentType: value });
  };

  const kebabName = kebab(agent.label);
  // "Not forked": the label still names the same agent the template picked (or hasn't been typed yet) —
  // editing it in place should write BACK to that agent rather than minting a new one.
  const nameNotForked = chosen != null && (agent.label.trim() === "" || kebabName === agent.agentType);
  const canOverride = chosen != null && nameNotForked && touched;
  const canSaveAsNew = KEBAB_RE.test(kebabName) && (chosen == null || !nameNotForked);
  const pluginLocked = chosen?.scope === "plugin";

  const doOverride = async () => {
    if (!chosen) return;
    try {
      const content = composeAgentMd(chosen.value, agent.model, tools, agent.prompt);
      await writeAgent({ scope: chosen.scope === "project" ? "project" : "user", name: chosen.value, content, overwrite: true });
      toast.success(`Updated agent "${chosen.value}"`);
      setTouched(false);
    } catch (e) {
      toast.error("Failed to update agent: " + String((e as Error).message ?? e));
    }
  };

  const doSaveAsNew = async () => {
    try {
      const content = composeAgentMd(kebabName, agent.model, tools, agent.prompt);
      await writeAgent({ scope: "user", name: kebabName, content, overwrite: false });
      toast.success(`Saved new agent "${kebabName}"`);
      onSetField({ agentType: kebabName });
      setTouched(false);
    } catch (e) {
      toast.error("Failed to save agent: " + String((e as Error).message ?? e));
    }
  };

  return (
    <div className="flex h-full w-96 shrink-0 flex-col overflow-hidden border-l border-border bg-background">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="text-sm font-medium text-foreground">Agent</span>
        <button type="button" onClick={onClose} aria-label="close details" className="text-muted-foreground hover:text-foreground">
          ✕
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <label className="space-y-1.5">
          <span className="text-xs text-muted-foreground">Name</span>
          <input
            aria-label="agent detail name"
            value={agent.label}
            onChange={(e) => setField({ label: e.target.value })}
            placeholder="short step name"
            className="flex h-8 w-full rounded-md border border-border bg-transparent px-3 text-sm text-foreground outline-none placeholder:text-foreground/60 focus-visible:ring-1 focus-visible:ring-ring"
          />
        </label>

        <label className="space-y-1.5">
          <span className="text-xs text-muted-foreground">Template — an existing agent</span>
          <AgentTypeCombobox value={agent.agentType} options={agents.map((a) => a.value)} onChange={(v) => setField({ agentType: v })} onSelect={selectTemplate} />
        </label>

        <section className="space-y-1.5">
          <span className="text-xs text-muted-foreground">Model{locked && " · provider from template"}</span>
          <div className="grid grid-cols-3 gap-2">
            <select
              aria-label="agent detail provider"
              disabled={locked}
              value={locked ? pinnedProviderId : agent.provider}
              onChange={(e) => setField({ provider: e.target.value })}
              className={SELECT_CLS}
            >
              {providerOptions.map((o) => (
                <option key={o || "d"} value={o}>
                  {o === "" ? "Default" : cap(o)}
                </option>
              ))}
            </select>
            <select aria-label="agent detail model" value={agent.model} onChange={(e) => setField({ model: e.target.value })} className={SELECT_CLS}>
              {modelOptions.map((o) => (
                <option key={o || "d"} value={o}>
                  {o === "" ? "Default" : cap(o)}
                </option>
              ))}
            </select>
            <select aria-label="agent detail effort" value={agent.effort} onChange={(e) => setField({ effort: e.target.value })} className={SELECT_CLS}>
              {effortOptions.map((o) => (
                <option key={o || "d"} value={o}>
                  {o === "" ? "Default" : cap(o)}
                </option>
              ))}
            </select>
          </div>
        </section>

        <section className="space-y-1.5">
          <span className="text-xs text-muted-foreground">Tools{chosen && " · from template"}</span>
          <div className="flex flex-wrap gap-1.5">
            {chosen
              ? tools.map((t) => (
                  <span key={t} className="rounded-md border border-border bg-muted px-2 py-1 text-[11px] text-foreground">
                    {t}
                  </span>
                ))
              : TOOLS.map((t) => {
                  const on = agent.tools.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setField({ tools: on ? agent.tools.filter((x) => x !== t) : [...agent.tools, t] })}
                      className={`rounded-md border px-2 py-1 text-[11px] transition ${on ? "border-foreground bg-muted text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
                    >
                      {t}
                    </button>
                  );
                })}
          </div>
        </section>

        <section className="space-y-1.5">
          <span className="text-xs text-muted-foreground">Instructions</span>
          <div className="rounded-md border border-border">
            <MarkdownEditor editable value={agent.prompt} onChange={(v) => setField({ prompt: v })} flush />
          </div>
        </section>
        <section className="space-y-1.5">
          <span className="text-xs text-muted-foreground">Result format (JSON schema, optional)</span>
          <textarea
            aria-label="agent detail schema"
            value={agent.schema}
            onChange={(e) => setField({ schema: e.target.value })}
            placeholder='{ "type": "object", "required": ["verdict"] }'
            className="min-h-24 w-full rounded-md border border-border bg-transparent p-2 font-mono text-[11px] text-foreground outline-none placeholder:text-foreground/60 focus-visible:ring-1 focus-visible:ring-ring"
          />
        </section>
      </div>

      <div className="space-y-2 border-t border-border p-3">
        {canOverride ? (
          <button
            type="button"
            disabled={pluginLocked}
            title={pluginLocked ? "Plugin agents can't be overwritten" : undefined}
            onClick={doOverride}
            className="w-full rounded-md border border-border bg-muted py-1.5 text-xs text-foreground transition enabled:hover:bg-muted/70 disabled:opacity-50"
          >
            Override Existing Agent
          </button>
        ) : canSaveAsNew ? (
          <button type="button" onClick={doSaveAsNew} className="w-full rounded-md border border-border bg-muted py-1.5 text-xs text-foreground transition hover:bg-muted/70">
            Save as new agent
          </button>
        ) : (
          <button type="button" disabled className="w-full rounded-md border border-border bg-muted py-1.5 text-xs text-foreground opacity-50">
            Saved
          </button>
        )}
        <button type="button" onClick={onClose} className="w-full rounded-md border border-transparent py-1 text-xs text-muted-foreground hover:text-foreground">
          Cancel
        </button>
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
  providerCatalog,
  writeAgent,
}: {
  agents: AgentOption[];
  providerCatalog: ProviderCatalogEntry[];
  writeAgent: (input: WriteAgentInput) => Promise<WriteAgentResult>;
}) {
  const { tree } = useEditor();
  const [selected, setSelected] = useState<OutlinePath | null>(null);

  const selectedNode = selected ? nodeAt(tree, selected) : null;
  const selectedAgent = selectedNode && "type" in selectedNode && selectedNode.type === "agent" ? selectedNode : null;

  const remove = (path: OutlinePath) => {
    editorStore.update((draft) => removeNode(draft, path));
    if (samePath(selected, path)) setSelected(null);
  };
  const add = (base: OutlinePath, kind: "agent" | "group") => editorStore.update((draft) => addStep(draft, base, kind));
  const toggle = (path: OutlinePath) => editorStore.update((draft) => toggleMode(draft, path));
  const rename = (path: OutlinePath, title: string) => editorStore.update((draft) => renameNode(draft, path, title));
  const setField = (path: OutlinePath, patch: Partial<Agent>) => editorStore.update((draft) => setAgentField(draft, path, patch));
  const applyTpl = (path: OutlinePath, agentType: string, info: { model: string; effort: string; provider: string }) =>
    editorStore.update((draft) => applyTemplate(draft, path, agentType, info));

  const rowsCallbacks: RowsCallbacks = {
    agents,
    providerCatalog,
    onSelect: setSelected,
    onToggleMode: toggle,
    onRename: rename,
    onSetField: setField,
    onRemove: remove,
    onAdd: add,
  };

  return (
    <div className="flex h-full min-h-0 flex-1">
      <div className="min-h-0 flex-1 overflow-auto bg-background p-4">
        <div className="mx-auto max-w-[520px] space-y-2.5">
          <Header tree={tree} />
          {tree.phases.map((phase, i) => (
            <PhaseBlock key={i} phase={phase} index={i} selected={selected} {...rowsCallbacks} />
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
      {selectedAgent && selected && (
        <AgentDetails
          key={selected.join(".")}
          agent={selectedAgent}
          agents={agents}
          providerCatalog={providerCatalog}
          writeAgent={writeAgent}
          onSetField={(patch) => setField(selected, patch)}
          onApplyTemplate={(agentType, info) => applyTpl(selected, agentType, info)}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
