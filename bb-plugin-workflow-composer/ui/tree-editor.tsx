// ui/tree-editor.tsx — the workflow editor as Miller columns (drill-right), like composer-graph:
// workflow → phase → step/agent, each level its own column. Controls are plain native HTML elements
// styled with host theme token classes so the panel reads like the Settings screens.
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  EFFORTS,
  blankAgent,
  blankContainer,
  blankPhase,
  type Agent,
  type Container,
  type ContainerMode,
  type Phase,
  type PhaseMode,
  type Step,
  type Tree,
} from "../workflow-model";
import { editorStore, type Selection } from "../store";
import { MarkdownEditor } from "../packages/md-editor/react";

const PHASE_MODE_LABELS: Record<PhaseMode, string> = { single: "Single", parallel: "Parallel", pipeline: "Pipeline" };
const CONTAINER_MODE_LABELS: Record<ContainerMode, string> = { parallel: "Parallel", pipeline: "Pipeline" };

// A discovered agent (from the `agents` RPC): its agentType value plus the model/effort/provider read
// from its own frontmatter. Every source scanned server-side today sits under a `.claude` directory, so
// `provider` is always "claude-code" — an agent found here always pins that provider.
interface AgentOption {
  value: string;
  model: string;
  effort: string;
  provider: string;
  description?: string;
  path?: string;
}
// The live provider/model/effort catalog (bb.sdk.providers), for restricting Model/Effort to a pinned
// agent's own provider.
interface ProviderCatalogEntry {
  id: string;
  name: string;
  models: { id: string; efforts: string[] }[];
}
// One file a .md file references (from the `agentRefs` RPC): a display label plus the path a drilled
// column re-fetches to keep walking deeper.
interface AgentRef {
  label: string;
  path: string;
}
// Given a .md file's path, its content plus the files it references — feeds the description column's
// and each drilled RefFileColumn's "Refers to" list. Optional: the standalone `render(<WorkflowEditor/>)`
// tests don't pass one, and every consumer below guards on its presence.
type LoadRefs = (path: string) => Promise<{ content: string; refs: AgentRef[] }>;

// Prepend an empty "default" option unless it's already there.
function withBlank(options: string[]): string[] {
  return options[0] === "" ? options : ["", ...options];
}

// ---- navigation helpers ----
function stepsArrayAt(tree: Tree, phase: number, containerPath: number[]): Step[] {
  let steps = tree.phases[phase].steps;
  for (const i of containerPath) steps = (steps[i] as Container).steps;
  return steps;
}
function nodeAtSelection(tree: Tree, sel: Selection): Phase | Step | null {
  if (sel.length === 0) return null;
  const phase = tree.phases[sel[0]];
  if (!phase) return null;
  if (sel.length === 1) return phase;
  let steps = phase.steps;
  let node: Step | undefined;
  for (let i = 1; i < sel.length; i++) {
    node = steps[sel[i]];
    if (!node) return null;
    if (node.type === "container") steps = node.steps;
    else if (i < sel.length - 1) return null;
  }
  return node ?? null;
}

const useEditor = () => useSyncExternalStore(editorStore.subscribe, editorStore.getSnapshot, editorStore.getSnapshot);

const COL = "flex h-full w-80 shrink-0 flex-col overflow-y-auto border-r border-border";

// ---- native form control styling (host theme tokens only) ----
const INPUT_CLS =
  "flex h-8 w-full rounded-md border border-border bg-transparent px-3 py-1 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
const TEXTAREA_CLS =
  "flex min-h-[60px] w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
const SELECT_CLS =
  "flex h-9 w-full items-center rounded-md border border-border bg-transparent px-3 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

// ---- small form primitives (Settings-like rhythm) ----
function Field({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-xs text-muted-foreground">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs leading-tight text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Choice({
  value,
  options,
  labels,
  onChange,
  ariaLabel,
}: {
  value: string;
  options: readonly string[];
  labels?: Record<string, string>;
  onChange: (v: string) => void;
  ariaLabel: string;
}) {
  return (
    <select aria-label={ariaLabel} className={SELECT_CLS} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o} value={o}>
          {labels?.[o] ?? (o === "" ? "default" : o)}
        </option>
      ))}
    </select>
  );
}

function Row({
  title,
  meta,
  active,
  onOpen,
  onRemove,
  removeLabel,
}: {
  title: string;
  meta?: string;
  active: boolean;
  onOpen: () => void;
  onRemove: () => void;
  removeLabel: string;
}) {
  return (
    <div className={`group flex items-center gap-1 rounded-md border ${active ? "border-border bg-muted" : "border-transparent hover:bg-muted"}`}>
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-left text-sm">
        <span className={`min-w-0 flex-1 truncate ${active ? "text-foreground" : "text-foreground/90"}`}>{title || "—"}</span>
        {meta && <span className="shrink-0 text-xs text-muted-foreground">{meta}</span>}
        <span className="shrink-0 text-muted-foreground">›</span>
      </button>
      <button
        type="button"
        aria-label={removeLabel}
        title="Delete"
        className="px-2 text-xs text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-destructive"
        onClick={onRemove}
      >
        ✕
      </button>
    </div>
  );
}

function AddRow({ onAgent, onContainer }: { onAgent: () => void; onContainer: () => void }) {
  const cls = "rounded-md border border-dashed border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground";
  return (
    <div className="flex gap-2 pt-1">
      <button type="button" className={cls} onClick={onAgent}>
        + Agent
      </button>
      <button type="button" className={cls} onClick={onContainer}>
        + Group
      </button>
    </div>
  );
}

function ColHeader({ children }: { children: ReactNode }) {
  return (
    <div className="sticky top-0 z-10 truncate border-b border-border bg-background/95 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="pt-1 text-sm font-medium text-foreground">{children}</div>;
}

// ---- columns ----

export function WorkflowEditor({
  models,
  agents = [],
  providerCatalog = [],
  loadRefs,
}: {
  models: string[];
  agents?: AgentOption[];
  providerCatalog?: ProviderCatalogEntry[];
  loadRefs?: LoadRefs;
}) {
  const { tree, selection } = useEditor();
  // Stack of file paths drilled into from the description column's (or a deeper column's) "Refers to"
  // list — one RefFileColumn per entry, rendered right of the description column in order.
  const [refDrill, setRefDrill] = useState<string[]>([]);

  const columns: ReactNode[] = [<WorkflowColumn key="wf" tree={tree} selected={selection[0]} />];

  // The path of the agent whose description column (if any) is currently shown — the drill stack tracks
  // this file, so navigating to a different agent (or away from one) must reset it.
  let descAgentPath: string | undefined;

  if (selection.length >= 1 && tree.phases[selection[0]]) {
    columns.push(<PhaseColumn key="phase" tree={tree} sel={[selection[0]]} selectedStep={selection[1]} />);
    for (let d = 1; d < selection.length; d++) {
      const nodeSel = selection.slice(0, d + 1);
      const node = nodeAtSelection(tree, nodeSel);
      if (!node || !("type" in node)) break;
      if (node.type === "container") {
        columns.push(<StepsColumn key={"c" + d} tree={tree} sel={nodeSel} selectedStep={selection[d + 1]} />);
      } else {
        columns.push(
          <AgentColumn key={"a" + d} sel={nodeSel} agent={node} models={models} agents={agents} providerCatalog={providerCatalog} />,
        );
        const knownAgent = agents.find((a) => a.value === node.agentType);
        if (knownAgent?.description) {
          descAgentPath = knownAgent.path;
          columns.push(
            <AgentDescriptionColumn
              key={"ad" + d}
              agent={knownAgent}
              loadRefs={loadRefs}
              onOpenRef={(path) => setRefDrill([path])}
            />,
          );
        }
        break;
      }
    }
  }

  useEffect(() => {
    setRefDrill([]);
  }, [descAgentPath]);

  if (loadRefs) {
    refDrill.forEach((path, depth) => {
      columns.push(<RefFileColumn key={"ref" + depth + ":" + path} path={path} depth={depth} loadRefs={loadRefs} setRefDrill={setRefDrill} />);
    });
  }

  return <div className="flex h-full min-h-0 flex-1 overflow-x-auto">{columns}</div>;
}

function WorkflowColumn({ tree, selected }: { tree: Tree; selected: number | undefined }) {
  return (
    <div className={COL}>
      <ColHeader>{tree.name || "Workflow"}</ColHeader>
      <div className="space-y-4 p-4">
        <Field label="Name" htmlFor="wf-name">
          <input id="wf-name" aria-label="workflow name" placeholder="name-with-hyphens" className={INPUT_CLS} value={tree.name} onChange={(e) => editorStore.setName(e.target.value)} />
        </Field>
        <Field label="Description" htmlFor="wf-desc" hint="Required to save to the project (bb engine).">
          <textarea
            id="wf-desc"
            aria-label="workflow description"
            placeholder="What the workflow does"
            className={`${TEXTAREA_CLS} min-h-16`}
            value={tree.description}
            onChange={(e) => editorStore.setDescription(e.target.value)}
          />
        </Field>

        <div className="space-y-1.5">
          <SectionTitle>Phases</SectionTitle>
          {tree.phases.map((phase, p) => (
            <Row
              key={p}
              title={phase.title}
              meta={PHASE_MODE_LABELS[phase.mode]}
              active={selected === p}
              onOpen={() => editorStore.select([p])}
              onRemove={() => {
                editorStore.update((t) => t.phases.splice(p, 1));
                editorStore.select([]);
              }}
              removeLabel={`delete phase ${p}`}
            />
          ))}
          <button
            type="button"
            className="rounded-md border border-dashed border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() =>
              editorStore.update((t) => {
                t.phases.push(blankPhase("Phase " + (t.phases.length + 1)));
                editorStore.select([t.phases.length - 1]);
              })
            }
          >
            + Phase
          </button>
        </div>
      </div>
    </div>
  );
}

function PhaseColumn({ tree, sel, selectedStep }: { tree: Tree; sel: Selection; selectedStep: number | undefined }) {
  const p = sel[0];
  const phase = tree.phases[p];
  const budgetOn = phase.repeatBudget != null && phase.repeatBudget > 0;
  return (
    <div className={COL}>
      <ColHeader>Phase · {phase.title || "—"}</ColHeader>
      <div className="space-y-4 p-4">
        <Field label="Title">
          <input aria-label="phase title" placeholder="phase title" className={INPUT_CLS} value={phase.title} onChange={(e) => editorStore.update((t) => (t.phases[p].title = e.target.value))} />
        </Field>
        <Field label="Mode">
          <Choice
            ariaLabel="phase mode"
            value={phase.mode}
            options={Object.keys(PHASE_MODE_LABELS)}
            labels={PHASE_MODE_LABELS}
            onChange={(v) => editorStore.update((t) => (t.phases[p].mode = v as PhaseMode))}
          />
        </Field>
        <div className="space-y-1.5">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              aria-label="phase repeat"
              className="accent-primary"
              checked={budgetOn}
              onChange={(e) => editorStore.update((t) => (t.phases[p].repeatBudget = e.target.checked ? 500000 : null))}
            />
            Repeat while token budget above
          </label>
          {budgetOn && (
            <input
              aria-label="phase budget"
              type="number"
              className={INPUT_CLS}
              value={phase.repeatBudget ?? 0}
              onChange={(e) => editorStore.update((t) => (t.phases[p].repeatBudget = Number(e.target.value) || null))}
            />
          )}
        </div>
        <StepList tree={tree} sel={sel} selectedStep={selectedStep} />
      </div>
    </div>
  );
}

function StepsColumn({ tree, sel, selectedStep }: { tree: Tree; sel: Selection; selectedStep: number | undefined }) {
  const container = nodeAtSelection(tree, sel) as Container;
  return (
    <div className={COL}>
      <ColHeader>Group · {CONTAINER_MODE_LABELS[container.mode]}</ColHeader>
      <div className="space-y-4 p-4">
        <Field label="Mode">
          <Choice
            ariaLabel="group mode"
            value={container.mode}
            options={Object.keys(CONTAINER_MODE_LABELS)}
            labels={CONTAINER_MODE_LABELS}
            onChange={(v) => editorStore.update((t) => ((nodeAtSelection(t, sel) as Container).mode = v as ContainerMode))}
          />
        </Field>
        <StepList tree={tree} sel={sel} selectedStep={selectedStep} />
      </div>
    </div>
  );
}

function StepList({ tree, sel, selectedStep }: { tree: Tree; sel: Selection; selectedStep: number | undefined }) {
  const phase = sel[0];
  const containerPath = sel.slice(1);
  const steps = stepsArrayAt(tree, phase, containerPath);

  const add = (make: () => Step) =>
    editorStore.update((t) => {
      const arr = stepsArrayAt(t, phase, containerPath);
      arr.push(make());
      editorStore.select([...sel, arr.length - 1]);
    });

  return (
    <div className="space-y-1.5">
      <SectionTitle>Steps</SectionTitle>
      {steps.map((step, i) => (
        <Row
          key={i}
          title={step.type === "agent" ? step.label || "agent" : "Group"}
          meta={step.type === "agent" ? undefined : CONTAINER_MODE_LABELS[step.mode]}
          active={selectedStep === i}
          onOpen={() => editorStore.select([...sel, i])}
          onRemove={() => {
            editorStore.update((t) => stepsArrayAt(t, phase, containerPath).splice(i, 1));
            editorStore.select(sel);
          }}
          removeLabel={`delete step ${i}`}
        />
      ))}
      <AddRow onAgent={() => add(blankAgent)} onContainer={() => add(() => blankContainer("parallel"))} />
    </div>
  );
}

// Cap the suggestion list so an empty filter over a large plugin catalog doesn't render hundreds of rows.
const AGENT_SUGGESTION_LIMIT = 50;

// Native combobox for "Agent type": the input stays free-text (bound straight to agent.agentType), and
// a suggestions dropdown opens on focus, filtered by substring match against the current value.
function AgentTypeCombobox({
  value,
  agents,
  onChange,
  onSelect,
}: {
  value: string;
  agents: string[];
  onChange: (v: string) => void;
  // Fired only when the user picks a suggestion (not on free typing) — the caller uses it to prefill
  // model/effort/provider from that agent's own frontmatter.
  onSelect?: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const needle = value.trim().toLowerCase();
  const matches = (needle ? agents.filter((a) => a.toLowerCase().includes(needle)) : agents).slice(0, AGENT_SUGGESTION_LIMIT);

  return (
    <div className="relative">
      <input
        aria-label="agent type"
        className={INPUT_CLS}
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
              // Selecting via mousedown fires before the input's blur, so the click still lands.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(a);
                onSelect?.(a);
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

function AgentColumn({
  sel,
  agent,
  models,
  agents = [],
  providerCatalog = [],
}: {
  sel: Selection;
  agent: Agent;
  models: string[];
  agents?: AgentOption[];
  providerCatalog?: ProviderCatalogEntry[];
}) {
  const setField = (field: keyof Agent, value: string) =>
    editorStore.update((t) => {
      const node = nodeAtSelection(t, sel) as Agent;
      (node[field] as string) = value;
    });

  // The discovered agent this step's "Agent type" currently names, if any — every discovered agent
  // pins a provider (see AgentOption), so finding one here fixes the Provider control.
  const knownAgent = agents.find((a) => a.value === agent.agentType) ?? null;
  const pinnedProviderId = knownAgent?.provider || "";

  // Keep the node's provider in sync with the pin, however agentType got its current value (typed or
  // picked from the suggestion list below).
  useEffect(() => {
    if (pinnedProviderId && agent.provider !== pinnedProviderId) setField("provider", pinnedProviderId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinnedProviderId, agent.provider]);

  const effectiveProviderId = pinnedProviderId || agent.provider;
  const effectiveProvider = providerCatalog.find((p) => p.id === effectiveProviderId) ?? null;

  // Model options: the effective provider's own models when one is known/chosen, else the flat catalog
  // fallback — always keeping the agent's current value selectable even if it fell out of the catalog.
  const rawModelOptions = effectiveProvider ? effectiveProvider.models.map((m) => m.id) : models;
  const modelOptions = withBlank(agent.model && !rawModelOptions.includes(agent.model) ? [agent.model, ...rawModelOptions] : rawModelOptions);

  const selectedModelEntry = effectiveProvider?.models.find((m) => m.id === agent.model) ?? null;
  const effortOptions = selectedModelEntry ? withBlank(selectedModelEntry.efforts) : EFFORTS;

  // Picking a known agent from the combobox prefills model/effort/provider from its own frontmatter;
  // free-typing an agentType that matches nothing leaves those fields exactly as the user set them.
  const selectAgentType = (value: string) => {
    const info = agents.find((a) => a.value === value);
    if (!info) return;
    editorStore.update((t) => {
      const node = nodeAtSelection(t, sel) as Agent;
      node.model = info.model;
      node.effort = info.effort;
      node.provider = info.provider;
    });
  };

  return (
    <div className={COL}>
      <ColHeader>Agent · {agent.label || "—"}</ColHeader>
      <div className="space-y-4 p-4">
        <Field label="Label">
          <input aria-label="agent label" placeholder="short step name" className={INPUT_CLS} value={agent.label} onChange={(e) => setField("label", e.target.value)} />
        </Field>
        <Field label="Prompt" hint="What the agent should do. In a pipeline, {{prev}} is available — the previous step's result.">
          {/* role="group" + aria-label keeps the field findable by getByLabelText/findByLabelText
              the way the plain <textarea> used to be — MarkdownEditor itself has no aria-label prop
              (it renders a contenteditable host, not a labelable form control). */}
          <div role="group" aria-label="agent prompt" className="rounded-md border border-border">
            <MarkdownEditor editable value={agent.prompt} onChange={(v) => setField("prompt", v)} flush />
          </div>
        </Field>
        <Field label="Agent type">
          <AgentTypeCombobox
            value={agent.agentType}
            agents={agents.map((a) => a.value)}
            onChange={(v) => setField("agentType", v)}
            onSelect={selectAgentType}
          />
        </Field>
        <Field label="Provider">
          {pinnedProviderId ? (
            <select aria-label="provider" className={SELECT_CLS} value={pinnedProviderId} disabled>
              <option value={pinnedProviderId}>{effectiveProvider?.name ?? pinnedProviderId}</option>
            </select>
          ) : (
            <select aria-label="provider" className={SELECT_CLS} value={agent.provider} onChange={(e) => setField("provider", e.target.value)}>
              <option value="">default / session</option>
              {providerCatalog.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Model">
            <Choice ariaLabel="agent model" value={agent.model} options={modelOptions} onChange={(v) => setField("model", v)} />
          </Field>
          <Field label="Effort">
            <Choice ariaLabel="agent effort" value={agent.effort} options={effortOptions} onChange={(v) => setField("effort", v)} />
          </Field>
        </div>
        <p className="text-xs leading-tight text-muted-foreground">
          Model, effort, and agent type only apply when saving to ~/.claude (Claude Code). In bb an agent uses the
          session's model unless provider, model, and effort are all set.
        </p>
        <Field label="Result schema (JSON, optional)">
          <textarea
            aria-label="agent schema"
            placeholder='e.g.: { "type": "object", "required": ["verdict"] }'
            className={`${TEXTAREA_CLS} min-h-16 font-mono text-xs`}
            value={agent.schema}
            onChange={(e) => setField("schema", e.target.value)}
          />
        </Field>
      </div>
    </div>
  );
}

// A clickable row for a referenced file — same shell/typography as Row's link button, minus the delete
// affordance (refs are read-only, there's nothing here to remove).
function RefRow({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full min-w-0 items-center gap-2 rounded-md border border-transparent px-2.5 py-1.5 text-left text-sm text-foreground/90 hover:bg-muted hover:text-foreground"
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 text-muted-foreground">›</span>
    </button>
  );
}

// Read-only column shown to the right of a resolved AgentColumn, when the selected "Agent type" matches
// a discovered agent (AgentOption) that carries a non-empty description. When `loadRefs` is given it also
// fetches the agent's own referenced files (skills, other docs) and lists them below the description;
// clicking one starts (or restarts) the drill stack from this file.
function AgentDescriptionColumn({
  agent,
  loadRefs,
  onOpenRef,
}: {
  agent: AgentOption;
  loadRefs?: LoadRefs;
  onOpenRef: (path: string) => void;
}) {
  const [refs, setRefs] = useState<AgentRef[]>([]);

  useEffect(() => {
    setRefs([]);
    if (!loadRefs || !agent.path) return;
    let cancelled = false;
    loadRefs(agent.path)
      .then((r) => {
        if (!cancelled) setRefs(r.refs);
      })
      .catch(() => {
        if (!cancelled) setRefs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [loadRefs, agent.path]);

  return (
    <div className={COL}>
      <ColHeader>Description</ColHeader>
      <div className="space-y-4 p-4">
        <p className="whitespace-normal break-words text-sm text-foreground">{agent.description}</p>
        {refs.length > 0 && (
          <div className="space-y-1.5">
            <SectionTitle>Refers to</SectionTitle>
            {refs.map((r) => (
              <RefRow key={r.path} label={r.label} onOpen={() => onOpenRef(r.path)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// One column of the recursive ref-drill stack: fetches `path`'s own content plus the files it in turn
// references, via the same `loadRefs` RPC. Clicking one of its own refs truncates the stack to this
// column's depth and pushes the clicked file — so drilling from a mid-stack column discards deeper
// columns opened from a since-abandoned path.
function RefFileColumn({
  path,
  depth,
  loadRefs,
  setRefDrill,
}: {
  path: string;
  depth: number;
  loadRefs: LoadRefs;
  setRefDrill: (update: (stack: string[]) => string[]) => void;
}) {
  const [data, setData] = useState<{ content: string; refs: AgentRef[] } | null>(null);

  useEffect(() => {
    setData(null);
    let cancelled = false;
    loadRefs(path)
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch(() => {
        if (!cancelled) setData({ content: "", refs: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [loadRefs, path]);

  const basename = path.split("/").pop() || path;
  const openRef = (refPath: string) => setRefDrill((stack) => stack.slice(0, depth + 1).concat(refPath));

  return (
    <div className={COL}>
      <ColHeader>{basename}</ColHeader>
      <div className="space-y-4 p-4">
        {data === null ? (
          <p className="text-xs text-muted-foreground">…</p>
        ) : (
          <>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted p-2 font-mono text-xs text-foreground">
              {data.content}
            </pre>
            {data.refs.length > 0 && (
              <div className="space-y-1.5">
                <SectionTitle>Refers to</SectionTitle>
                {data.refs.map((r) => (
                  <RefRow key={r.path} label={r.label} onOpen={() => openRef(r.path)} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
