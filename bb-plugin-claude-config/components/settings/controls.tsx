import { useEffect, useRef, useState, type ReactNode } from "react";

import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  AUTO_MODE_DEFAULTS as snapshot,
  ENV_FIELDS,
  ENV_GROUPS,
  ENV_TEMPLATE as template,
  filledProjectFields,
  joinItems,
  listItems,
  readEnvironment,
  readRules,
  readVisibility,
  ruleTitle,
  toggleBuiltin,
  withEnvValue,
  withoutFields,
  writeEnvironment,
  writeRules,
  type EnvField,
  type EnvState,
  type RuleState,
} from "../../src/auto-mode";
import {
  PERMISSION_TOOLS,
  formatPermissionRule,
  groupLines,
  modeChoices,
  modeOf,
  parseInline,
  parsePermissionRule,
  ruleSetFor,
  rulesOf,
  withMode,
  withRules,
  withoutGroup,
  type RuleSetObject,
} from "../../src/rule-set";

export function Switch({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
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
    thumbRef.current?.style.setProperty("background-color", "var(--background)", "important");
  }, []);
  return (
    <button
      ref={trackRef}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors",
        disabled && "cursor-default opacity-60",
      )}
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

export function Dropdown<T extends string>({
  value,
  options,
  disabled,
  onChange,
  className,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  disabled: boolean;
  onChange: (next: T) => void;
  className?: string;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as T)}
      className={cn(
        "h-8 max-w-full rounded-md border border-border bg-background px-2 text-sm",
        disabled && "opacity-50",
        className,
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
 * The value an editor builds its next edit on. Until the last write in flight
 * settles, edits build on this local copy rather than on the prop, which only
 * catches up after the panel reloads — otherwise a second quick edit would
 * overwrite the first. A failed write drops the copy and shows what's on disk.
 */
function usePendingValue(
  object: RuleSetObject,
  onChange: (next: RuleSetObject) => Promise<boolean>,
): [RuleSetObject, (next: RuleSetObject) => void] {
  const [pending, setPending] = useState<RuleSetObject | null>(null);
  const inFlight = useRef(0);
  const propText = JSON.stringify(object);
  useEffect(() => {
    if (inFlight.current === 0) setPending(null);
  }, [propText]);
  const write = (next: RuleSetObject) => {
    setPending(next);
    inFlight.current += 1;
    void onChange(next).then((saved) => {
      inFlight.current -= 1;
      if (!saved) setPending(null);
    });
  };
  return [pending ?? object, write];
}

const withLines = (object: RuleSetObject, key: string, lines: readonly string[] | undefined) =>
  lines === undefined ? withoutGroup(object, key) : withRules(object, key, lines);

/** Text with `code` and **bold** spans. */
function InlineText({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((span, index) =>
        span.kind === "code" ? (
          <code key={index} className="rounded bg-muted px-1 font-mono text-[0.92em]">
            {span.text}
          </code>
        ) : span.kind === "strong" ? (
          <strong key={index} className="font-semibold">
            {span.text}
          </strong>
        ) : (
          <span key={index}>{span.text}</span>
        ),
      )}
    </>
  );
}

function SubHeading({ children }: { children: ReactNode }) {
  return <div className="mb-1.5 mt-5 text-xs font-semibold first:mt-0">{children}</div>;
}

function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="inline-flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <Icon name="X" className="size-3" />
    </button>
  );
}

/** Items as chips with ×, and a field that adds one on Enter. */
function ChipList({
  items,
  placeholder,
  readOnly,
  onChange,
}: {
  items: readonly string[];
  placeholder: string;
  readOnly: boolean;
  onChange: (next: readonly string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-1">
      {items.map((item, index) => (
        <span
          key={`${index}-${item}`}
          className="inline-flex min-h-6 max-w-full items-center gap-1 rounded-md border border-border py-0.5 pl-2 pr-1 text-sm"
        >
          <span className="min-w-0 [overflow-wrap:anywhere]">{item}</span>
          {!readOnly && (
            <RemoveButton
              label={`Remove ${item}`}
              onClick={() => onChange(items.filter((_, at) => at !== index))}
            />
          )}
        </span>
      ))}
      {!readOnly && (
        <input
          value={draft}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || draft.trim() === "") return;
            onChange([...items, draft.trim()]);
            setDraft("");
          }}
          className="h-6 w-48 rounded-md border border-dashed border-border bg-transparent px-2 text-sm outline-none focus:border-solid focus:border-muted-foreground"
        />
      )}
      {readOnly && items.length === 0 && <span className="text-sm text-muted-foreground">None</span>}
    </div>
  );
}

/** Multi-line text committed on blur; blank means "back to the default". */
function TextField({
  value,
  placeholder,
  readOnly,
  onCommit,
}: {
  value: string;
  placeholder: string;
  readOnly: boolean;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <textarea
      value={draft}
      readOnly={readOnly}
      placeholder={placeholder}
      rows={Math.max(1, Math.ceil(draft.length / 70))}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      className="min-h-8 w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm leading-[18px] outline-none placeholder:text-muted-foreground/70 focus:border-muted-foreground"
    />
  );
}

const shorten = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function EnvFieldRow({
  field,
  state,
  scope,
  readOnly,
  onChange,
}: {
  field: EnvField;
  state: EnvState;
  scope: "global" | "project";
  readOnly: boolean;
  onChange: (next: EnvState) => void;
}) {
  const value = state.values[field.key];
  const fallback = template[field.key] ?? "None configured";
  const set = (text: string) => onChange(withEnvValue(state, field.key, text, template));
  const control =
    field.kind === "list" ? (
      <ChipList
        items={value === undefined ? [] : listItems(value)}
        placeholder={`Add — e.g. ${field.example}`}
        readOnly={readOnly}
        onChange={(items) => set(joinItems(items))}
      />
    ) : field.kind === "visibility" ? (
      <VisibilityControl value={value} readOnly={readOnly} onChange={set} />
    ) : (
      <TextField value={value ?? ""} placeholder={shorten(fallback, 110)} readOnly={readOnly} onCommit={set} />
    );
  return (
    <div className="grid grid-cols-1 gap-x-5 gap-y-1.5 border-t border-border/60 py-2.5 first:border-t-0 @2xl:grid-cols-[220px_1fr]">
      <div>
        <div className="text-sm font-medium">{field.key}</div>
        <div className="text-xs text-muted-foreground">{field.description}</div>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        {control}
        {scope === "global" && field.projectOnly && value !== undefined && (
          <div className="flex flex-wrap items-start gap-x-2 gap-y-1 text-xs text-warning">
            <Icon name="AlertTriangle" className="mt-px size-3.5 shrink-0" />
            <span className="min-w-44 flex-1">
              Describes one project, but applies to every project. Claude Code already trusts the
              repository a session runs in.
            </span>
            {!readOnly && (
              <button
                type="button"
                onClick={() => onChange(withoutFields(state, [field.key]))}
                className="rounded-md border border-border px-2 py-0.5 text-foreground hover:bg-muted"
              >
                Remove from Globally
              </button>
            )}
          </div>
        )}
        {value !== undefined && !readOnly && !(scope === "global" && field.projectOnly) && (
          <button
            type="button"
            onClick={() => set("")}
            className="self-start text-xs text-muted-foreground hover:underline"
          >
            Reset to default
          </button>
        )}
        {value === undefined && field.kind === "list" && (
          <div className="text-xs text-muted-foreground/80">Default: {shorten(fallback, 140)}</div>
        )}
      </div>
    </div>
  );
}

function VisibilityControl({
  value,
  readOnly,
  onChange,
}: {
  value: string | undefined;
  readOnly: boolean;
  onChange: (next: string) => void;
}) {
  const visibility = readVisibility(value);
  const options = [
    { value: "", label: "Detect from remote (default)" },
    { value: "private", label: "Private" },
    { value: "public", label: "Public" },
    ...(visibility.kind === "custom" ? [{ value: visibility.text, label: shorten(visibility.text, 50) }] : []),
  ];
  const current = visibility.kind === "custom" ? visibility.text : visibility.kind === "default" ? "" : visibility.kind;
  return <Dropdown value={current} options={options} disabled={readOnly} onChange={onChange} className="self-start" />;
}

type AutoTab = "environment" | "allow" | "soft_deny" | "hard_deny";

const RULE_GROUPS: readonly { key: Exclude<AutoTab, "environment">; label: string }[] = [
  { key: "allow", label: "Allow" },
  { key: "soft_deny", label: "Soft deny" },
  { key: "hard_deny", label: "Hard deny" },
];

/**
 * autoMode as a form: the environment template field by field, and each rule
 * group as own rules plus the built-in list with a switch per rule.
 * `readOnly` — the project scope, where Claude Code doesn't read autoMode.
 */
export function AutoModeEditor({
  object,
  onChange,
  scope,
  readOnly,
}: {
  object: RuleSetObject;
  onChange: (next: RuleSetObject) => Promise<boolean>;
  scope: "global" | "project";
  readOnly: boolean;
}) {
  const [current, write] = usePendingValue(object, onChange);
  const [tab, setTab] = useState<AutoTab>("environment");
  const env = readEnvironment(groupLines(current, "environment"), template);
  const rules = (group: Exclude<AutoTab, "environment">) =>
    readRules(groupLines(current, group), snapshot[group]);
  const count = (group: Exclude<AutoTab, "environment">) => {
    const state = rules(group);
    return snapshot[group].length - state.off.size + state.own.length;
  };
  const tabs = [
    { key: "environment" as const, label: "Environment", count: Object.keys(env.values).length || null },
    ...RULE_GROUPS.map((group) => ({ ...group, count: count(group.key) })),
  ];

  return (
    <div className="@container">
      <div className="mb-4 flex gap-0.5 overflow-x-auto border-b border-border/60">
        {tabs.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => setTab(entry.key)}
            className={cn(
              "-mb-px h-8 whitespace-nowrap border-b-2 px-2.5 text-sm",
              tab === entry.key
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {entry.label}
            {entry.count !== null && <span className="ml-1 font-normal text-muted-foreground">{entry.count}</span>}
          </button>
        ))}
      </div>
      {tab === "environment" ? (
        <EnvironmentForm
          state={env}
          scope={scope}
          readOnly={readOnly}
          onChange={(next) => write(withLines(current, "environment", writeEnvironment(next, template)))}
        />
      ) : (
        <RuleGroupForm
          key={tab}
          builtins={snapshot[tab]}
          state={rules(tab)}
          readOnly={readOnly}
          onChange={(next) => write(withLines(current, tab, writeRules(next, snapshot[tab])))}
        />
      )}
    </div>
  );
}

function EnvironmentForm({
  state,
  scope,
  readOnly,
  onChange,
}: {
  state: EnvState;
  scope: "global" | "project";
  readOnly: boolean;
  onChange: (next: EnvState) => void;
}) {
  const misplaced = scope === "global" ? filledProjectFields(state) : [];
  return (
    <div className="max-w-4xl">
      {misplaced.length > 1 && !readOnly && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-warning">
          <Icon name="AlertTriangle" className="size-3.5" />
          <span>{misplaced.length} fields describe one project.</span>
          <button
            type="button"
            onClick={() => onChange(withoutFields(state, misplaced.map((entry) => entry.key)))}
            className="rounded-md border border-border px-2 py-0.5 text-foreground hover:bg-muted"
          >
            Remove all from Globally
          </button>
        </div>
      )}
      {ENV_GROUPS.map((group) => (
        <div key={group.key}>
          <SubHeading>{group.label}</SubHeading>
          <div>
            {ENV_FIELDS.filter((entry) => entry.group === group.key).map((entry) => (
              <EnvFieldRow
                key={entry.key}
                field={entry}
                state={state}
                scope={scope}
                readOnly={readOnly}
                onChange={onChange}
              />
            ))}
          </div>
        </div>
      ))}
      {state.extra.length > 0 && (
        <>
          <SubHeading>Other lines</SubHeading>
          <div className="text-xs text-muted-foreground">
            Lines the form doesn't know. They stay in the file as they are; edit them with Edit as JSON.
          </div>
          <ul className="mt-1.5 space-y-1 text-sm">
            {state.extra.map((line, index) => (
              <li key={index} className="[overflow-wrap:anywhere]">
                <InlineText text={line} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function RuleGroupForm({
  builtins,
  state,
  readOnly,
  onChange,
}: {
  builtins: readonly string[];
  state: RuleState;
  readOnly: boolean;
  onChange: (next: RuleState) => void;
}) {
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [when, setWhen] = useState("");
  const add = () => {
    if (name.trim() === "") return;
    const text = when.trim() === "" ? name.trim() : `${name.trim()}: ${when.trim()}`;
    onChange({ ...state, own: [...state.own, text] });
    setName("");
    setWhen("");
  };
  const needle = filter.trim().toLowerCase();
  const shown = builtins
    .map((rule, index) => ({ ...ruleTitle(rule), index }))
    .filter((rule) => needle === "" || `${rule.name} ${rule.description}`.toLowerCase().includes(needle));

  return (
    <div className="max-w-4xl">
      <SubHeading>Your rules</SubHeading>
      {state.own.length === 0 && <div className="px-2 py-1 text-sm text-muted-foreground">None yet.</div>}
      {state.own.map((rule, index) => (
        <div key={`${index}-${rule}`} className="group flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40">
          <div className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">
            <InlineText text={rule} />
          </div>
          {!readOnly && (
            <span className="opacity-0 group-hover:opacity-100">
              <RemoveButton
                label="Remove rule"
                onClick={() => onChange({ ...state, own: state.own.filter((_, at) => at !== index) })}
              />
            </span>
          )}
        </div>
      ))}
      {!readOnly && (
        <div className="mt-1.5 grid grid-cols-1 gap-2 @2xl:grid-cols-[220px_1fr_auto]">
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name — e.g. Staging deploy" className="h-8" />
          <Input
            value={when}
            onChange={(event) => setWhen(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && add()}
            placeholder="When it applies — e.g. deploying to the staging project"
            className="h-8"
          />
          <button type="button" onClick={add} className="h-8 rounded-md border border-border px-3 text-sm hover:bg-muted">
            Add rule
          </button>
        </div>
      )}

      <SubHeading>Built-in</SubHeading>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {builtins.length > 6 && (
          <Input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter rules" className="h-8 w-64" />
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {builtins.length - state.off.size} of {builtins.length} on
        </span>
      </div>
      {state.off.size > 0 && (
        <div className="mb-2 text-xs text-muted-foreground">
          While a built-in rule is off, the rest are pinned to Claude Code {snapshot.claudeCodeVersion} and
          don't pick up updates. Turn every rule back on to follow Claude Code again.
        </div>
      )}
      {shown.map((rule) => {
        const on = !state.off.has(rule.index);
        return (
          <div key={rule.index} className="grid grid-cols-[28px_1fr] gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/40">
            <div className="pt-0.5">
              <Switch checked={on} disabled={readOnly} onChange={() => onChange(toggleBuiltin(state, rule.index))} />
            </div>
            <button
              type="button"
              onClick={() => setOpen(open === rule.index ? null : rule.index)}
              className={cn("min-w-0 text-left", !on && "opacity-50")}
            >
              <div className="text-sm font-medium">{rule.name}</div>
              <div className={cn("text-xs text-muted-foreground", open === rule.index ? "[overflow-wrap:anywhere]" : "truncate")}>
                <InlineText text={rule.description} />
              </div>
            </button>
          </div>
        );
      })}
    </div>
  );
}

const MODE_LABELS: Readonly<Record<string, string>> = {
  default: "Ask before edits and commands",
  acceptEdits: "Accept edits, ask for commands",
  plan: "Plan mode",
  auto: "Auto mode — classifier decides",
  dontAsk: "Don't ask — deny what isn't allowed",
  bypassPermissions: "Bypass permissions",
};

const PERMISSION_GROUPS = [
  { key: "allow", label: "Allow", hint: "Runs without asking." },
  { key: "ask", label: "Ask", hint: "Always asks, even in auto mode." },
  { key: "deny", label: "Deny", hint: "Never runs." },
] as const;

/** permissions as a form: default mode, rules as tool + pattern, extra folders. */
export function PermissionsEditor({
  object,
  onChange,
}: {
  object: RuleSetObject;
  onChange: (next: RuleSetObject) => Promise<boolean>;
}) {
  const [current, write] = usePendingValue(object, onChange);
  const mode = ruleSetFor("permissions")!.mode!;
  const currentMode = modeOf(current, mode.key);
  const modeOptions = [
    { value: "", label: "Not set" },
    ...modeChoices(mode, currentMode).map((value) => ({ value, label: MODE_LABELS[value] ?? value })),
  ];
  return (
    <div className="max-w-4xl @container">
      <div className="grid grid-cols-1 gap-x-5 gap-y-1.5 @2xl:grid-cols-[220px_1fr]">
        <div>
          <div className="text-sm font-medium">Default mode</div>
          <div className="text-xs text-muted-foreground">How a session starts.</div>
        </div>
        <Dropdown
          value={currentMode ?? ""}
          options={modeOptions}
          disabled={false}
          className="self-start"
          onChange={(next) => write(next === "" ? withoutGroup(current, mode.key) : withMode(current, mode.key, next))}
        />
      </div>
      {PERMISSION_GROUPS.map((group) => (
        <PermissionGroup
          key={group.key}
          label={group.label}
          hint={group.hint}
          rules={rulesOf(current, group.key)}
          onChange={(rules) => write(withRules(current, group.key, rules))}
        />
      ))}
      <SubHeading>Additional directories</SubHeading>
      <ChipList
        items={rulesOf(current, "additionalDirectories")}
        placeholder="Add a folder"
        readOnly={false}
        onChange={(items) => write(withRules(current, "additionalDirectories", items))}
      />
    </div>
  );
}

function PermissionGroup({
  label,
  hint,
  rules,
  onChange,
}: {
  label: string;
  hint: string;
  rules: readonly string[];
  onChange: (next: readonly string[]) => void;
}) {
  const [tool, setTool] = useState(PERMISSION_TOOLS[0].tool);
  const [pattern, setPattern] = useState("");
  const entry = PERMISSION_TOOLS.find((candidate) => candidate.tool === tool) ?? PERMISSION_TOOLS[0];
  const add = () => {
    const trimmed = pattern.trim();
    const text =
      entry.tool === "mcp" ? trimmed : formatPermissionRule(entry.tool, trimmed === "" ? null : trimmed);
    if (text === "") return;
    onChange([...rules, text]);
    setPattern("");
  };
  return (
    <>
      <SubHeading>{label}</SubHeading>
      <div className="-mt-1 mb-1.5 text-xs text-muted-foreground">{hint}</div>
      {rules.length === 0 && <div className="px-2 py-1 text-sm text-muted-foreground">No rules.</div>}
      {rules.map((rule, index) => {
        const parsed = parsePermissionRule(rule);
        return (
          <div key={`${index}-${rule}`} className="group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted/40">
            <span className="shrink-0 rounded bg-muted px-1.5 font-mono text-xs">{parsed.tool}</span>
            <span className={cn("min-w-0 flex-1 text-sm [overflow-wrap:anywhere]", parsed.pattern === null && "text-muted-foreground")}>
              {parsed.pattern ?? "any call"}
            </span>
            <span className="opacity-0 group-hover:opacity-100">
              <RemoveButton label="Remove rule" onClick={() => onChange(rules.filter((_, at) => at !== index))} />
            </span>
          </div>
        );
      })}
      <div className="mt-1.5 grid grid-cols-1 gap-2 @2xl:grid-cols-[140px_1fr_auto]">
        <Dropdown
          value={tool}
          options={PERMISSION_TOOLS.map((candidate) => ({ value: candidate.tool, label: candidate.label }))}
          disabled={false}
          onChange={setTool}
        />
        <Input
          value={pattern}
          onChange={(event) => setPattern(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && add()}
          placeholder={entry.example === "" ? "No pattern" : entry.example}
          className="h-8"
        />
        <button type="button" onClick={add} className="h-8 rounded-md border border-border px-3 text-sm hover:bg-muted">
          Add
        </button>
      </div>
      <div className="mt-1 text-xs text-muted-foreground/80">
        {entry.hint}
        {entry.tool === "mcp" ? "" : " · leave empty for any call"}
      </div>
    </>
  );
}
