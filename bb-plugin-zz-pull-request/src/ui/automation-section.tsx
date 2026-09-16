// The "Triggers and actions" section of the plugin's settings page — the table
// the machinery runs on (src/core/automation.ts). A row is trigger tags on the
// left and action tags on the right; rows are grouped by the kind of their
// first trigger. The row number turns into a drag handle on hover; a row moves
// within its group and is saved on release. Every other edit is saved at once.
// Layout and idiom follow Flow's work-stages table (bb-plugin-flow/app/stage-settings.tsx).
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  ACTION_IDS,
  ACTIONS,
  DEFAULT_RULES,
  DOMAIN_ICON,
  RULE_GROUPS,
  TRIGGER_IDS,
  TRIGGERS,
  isDisplayAction,
  isShowAction,
  moveRule,
  ruleGroup,
  ruleProblems,
  sameRules,
  type ActionId,
  type AutomationRules,
  type Rule,
  type TriggerId,
} from "@/src/core/automation";
import { useAutomationRules } from "@/src/ui/automation-rules";
import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

type Side = "triggers" | "actions";

const square = "flex size-7 shrink-0 items-center justify-center rounded-md";
const popover =
  "absolute left-0 top-full z-20 mt-1 max-h-80 w-max min-w-full max-w-[22rem] overflow-auto rounded-lg border border-border bg-card p-1 shadow-lg";
const popoverItem =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-state-hover disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent";
/** Number with handle, triggers, arrow, actions, delete; on a narrow page actions go under triggers. */
const rowGrid =
  "grid grid-cols-[28px_minmax(0,1fr)_28px] items-start gap-2 @[40rem]:grid-cols-[28px_minmax(0,1fr)_20px_minmax(0,1.4fr)_28px]";

const newRuleId = (): string => `rule-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const iconOf = (side: Side, id: TriggerId | ActionId): IconName =>
  side === "triggers" ? TRIGGERS[id as TriggerId].icon : DOMAIN_ICON[ACTIONS[id as ActionId].domain];

const labelOf = (side: Side, id: TriggerId | ActionId): string =>
  side === "triggers" ? TRIGGERS[id as TriggerId].label : ACTIONS[id as ActionId].label;

const withRule = (rules: AutomationRules, id: string, change: (rule: Rule) => Rule): AutomationRules => ({
  version: 1,
  rules: rules.rules.map((rule) => (rule.id === id ? change(rule) : rule)),
});

/** Closes a popover on a press outside its root. */
function useDismiss(open: boolean, root: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (root.current !== null && !root.current.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, root, close]);
}

/** Drag by the handle: the row moves live and the order is saved on release. */
function useRowDrag(table: RefObject<HTMLDivElement | null>, rules: AutomationRules, show: (next: AutomationRules) => void, save: (next: AutomationRules) => void) {
  const [dragged, setDragged] = useState<string | null>(null);
  const latest = useRef(rules);
  latest.current = rules;
  useEffect(() => {
    if (dragged === null) return;
    const onMove = (event: PointerEvent) => {
      const rows = Array.from(table.current?.querySelectorAll<HTMLElement>("[data-rule-row]") ?? []);
      const from = rows.findIndex((row) => row.dataset.ruleRow === dragged);
      const to = rows.filter((row) => {
        const box = row.getBoundingClientRect();
        return box.top + box.height / 2 < event.clientY;
      }).length;
      const target = to > from ? to - 1 : to;
      if (from !== -1 && target !== from) show(moveRule(latest.current, dragged, target));
    };
    const onUp = () => {
      setDragged(null);
      save(latest.current);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragged, table, show, save]);
  return { dragged, grab: setDragged };
}

function TagMenu({ side, taken, onPick }: { side: Side; taken: readonly string[]; onPick: (id: TriggerId | ActionId) => void }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const groups =
    side === "triggers"
      ? RULE_GROUPS.filter((g) => g.group !== "none").map((g) => ({
          title: g.label,
          ids: TRIGGER_IDS.filter((id) => TRIGGERS[id].group === g.group) as readonly (TriggerId | ActionId)[],
        }))
      : [
          { title: "Кнопка", ids: ACTION_IDS.filter((id) => ACTIONS[id].domain === "button") },
          { title: "Уведомление", ids: ACTION_IDS.filter((id) => ACTIONS[id].domain === "notify") },
          { title: "Статус треда", ids: ACTION_IDS.filter((id) => ACTIONS[id].domain === "status") },
          { title: "Git", ids: ACTION_IDS.filter((id) => ACTIONS[id].domain === "git") },
          { title: "Действия в bb", ids: ACTION_IDS.filter((id) => ACTIONS[id].domain === "bb") },
          { title: "Файлы", ids: ACTION_IDS.filter((id) => ACTIONS[id].domain === "files") },
        ];
  const found = groups
    .map((g) => ({ ...g, ids: g.ids.filter((id) => q === "" || labelOf(side, id).toLowerCase().includes(q) || id.includes(q)) }))
    .filter((g) => g.ids.length > 0);
  return (
    <div role="menu" aria-label={side === "triggers" ? "Триггеры" : "Действия"} className={cn(popover, "min-w-[18rem]")}>
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={side === "triggers" ? "Найти триггер" : "Найти действие"}
        className="mb-1 h-7 w-full rounded-md border-0 bg-surface-recessed-solid px-2 text-[13px] outline-none placeholder:text-muted-foreground"
      />
      {found.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">Ничего не найдено</div>}
      {found.map((g) => (
        <div key={g.title} role="group" aria-label={g.title}>
          <div className="px-2 pb-0.5 pt-1.5 text-[11px] text-muted-foreground">{g.title}</div>
          {g.ids.map((id) => {
            const when = side === "actions" ? ACTIONS[id as ActionId].when : undefined;
            return (
              <button key={id} type="button" role="menuitem" disabled={taken.includes(id)} onClick={() => onPick(id)} className={popoverItem}>
                <Icon name={iconOf(side, id)} aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  <span>{labelOf(side, id)}</span>
                  {when !== undefined && <span className="line-clamp-1 text-[11px] text-muted-foreground">когда {when}</span>}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Tags({
  side,
  rule,
  focus,
  onFocus,
  onChange,
}: {
  side: Side;
  rule: Rule;
  focus: TriggerId | null;
  onFocus: (id: TriggerId) => void;
  onChange: (ids: readonly (TriggerId | ActionId)[]) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const close = useMemo(() => () => setOpen(false), []);
  useDismiss(open, root, close);
  const ids: readonly (TriggerId | ActionId)[] = side === "triggers" ? rule.triggers : rule.actions;
  const effects: readonly ActionId[] = side === "actions" ? rule.actions.filter((id) => !isDisplayAction(id)) : [];
  return (
    <div ref={root} className="relative flex min-w-0 flex-wrap items-center gap-1">
      {ids.map((id) => {
        const order = side === "actions" && effects.length > 1 && !isDisplayAction(id as ActionId) ? effects.indexOf(id as ActionId) + 1 : null;
        const label = labelOf(side, id);
        const when = side === "actions" ? ACTIONS[id as ActionId].when : undefined;
        return (
          <span
            key={id}
            title={when !== undefined ? `Когда ${when}` : undefined}
            className={cn(
              "inline-flex h-7 max-w-full items-center gap-1.5 rounded-md bg-card pl-2 pr-0.5 text-xs",
              side === "triggers" && "cursor-pointer hover:bg-state-hover",
              side === "triggers" && focus === id && "bg-state-active",
            )}
            onClick={side === "triggers" ? () => onFocus(id as TriggerId) : undefined}
          >
            {order !== null && <span className="text-[11px] tabular-nums text-muted-foreground">{order}</span>}
            <Icon name={iconOf(side, id)} aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate">
              {label}
              {/* A button tag says when it appears: its row's triggers only make it re-check this. */}
              {side === "actions" && isShowAction(id as ActionId) && when !== undefined && <span className="text-muted-foreground"> · {when}</span>}
            </span>
            <button
              type="button"
              aria-label={`Убрать «${label}»`}
              onClick={(e) => {
                e.stopPropagation();
                onChange(ids.filter((x) => x !== id));
              }}
              className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-state-hover hover:text-foreground"
            >
              <Icon name="X" aria-hidden="true" className="size-3" />
            </button>
          </span>
        );
      })}
      {ids.length === 0 && <span className="px-1 text-xs text-muted-foreground">{side === "triggers" ? "Триггер" : "Действие"}</span>}
      <button
        type="button"
        aria-label={side === "triggers" ? "Добавить триггер" : "Добавить действие"}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cn(square, "text-muted-foreground hover:bg-state-hover hover:text-foreground")}
      >
        <Icon name="Plus" aria-hidden="true" className="size-3.5" />
      </button>
      {open && (
        <TagMenu
          side={side}
          taken={ids}
          onPick={(id) => {
            onChange([...ids, id]);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function RuleRow({
  rule,
  index,
  dragging,
  focus,
  onGrab,
  onFocus,
  onChange,
  onDelete,
}: {
  rule: Rule;
  index: number;
  dragging: boolean;
  focus: TriggerId | null;
  onGrab: () => void;
  onFocus: (id: TriggerId) => void;
  onChange: (rule: Rule) => void;
  onDelete: () => void;
}) {
  const problems = ruleProblems(rule);
  const lit = focus !== null && rule.triggers.includes(focus);
  return (
    <div
      role="row"
      aria-label={`Строка ${index + 1}`}
      data-rule-row={rule.id}
      className={cn(
        "group bg-surface-recessed-solid py-2 pl-1 pr-2",
        (dragging || lit) && "bg-state-active",
        focus !== null && !lit && "opacity-50",
      )}
    >
      <div className={rowGrid}>
        <span role="cell" className="relative flex size-7 items-center justify-center">
          <span className="text-xs tabular-nums text-muted-foreground group-hover:opacity-0">{index + 1}</span>
          <button
            type="button"
            aria-label={`Перетащить строку ${index + 1}`}
            onPointerDown={(e) => {
              e.preventDefault();
              onGrab();
            }}
            className={cn(
              square,
              "absolute inset-0 cursor-grab touch-none text-muted-foreground opacity-0 hover:bg-state-hover hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100",
              dragging && "cursor-grabbing opacity-100",
            )}
          >
            <Icon name="DragDropVertical" aria-hidden="true" className="size-3.5" />
          </button>
        </span>
        <span role="cell" className="min-w-0">
          <Tags side="triggers" rule={rule} focus={focus} onFocus={onFocus} onChange={(ids) => onChange({ ...rule, triggers: ids as TriggerId[] })} />
        </span>
        <span role="cell" aria-hidden="true" className="hidden h-7 items-center justify-center text-muted-foreground @[40rem]:flex">
          <Icon name="ArrowRight" className="size-3.5" />
        </span>
        <span role="cell" className="col-start-2 row-start-2 min-w-0 @[40rem]:col-start-auto @[40rem]:row-start-auto">
          <Tags side="actions" rule={rule} focus={focus} onFocus={onFocus} onChange={(ids) => onChange({ ...rule, actions: ids as ActionId[] })} />
        </span>
        <span role="cell" className="col-start-3 row-start-1 @[40rem]:col-start-auto @[40rem]:row-start-auto">
          <button
            type="button"
            aria-label={`Удалить строку ${index + 1}`}
            onClick={onDelete}
            className={cn(square, "text-muted-foreground opacity-0 hover:bg-state-hover hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100")}
          >
            <Icon name="X" aria-hidden="true" className="size-3.5" />
          </button>
        </span>
      </div>
      {problems.map((problem) => (
        <div key={problem} className="pl-9 pt-1 text-xs text-destructive">
          {problem}
        </div>
      ))}
    </div>
  );
}

export function AutomationSection() {
  const { rules: saved, loaded, failed, save } = useAutomationRules();
  // The rows on screen: equal to the saved rules except mid-drag, when the
  // order moves live and is saved only on release.
  const [draft, setDraft] = useState<AutomationRules | null>(null);
  const rules = draft ?? saved;
  const [focus, setFocus] = useState<TriggerId | null>(null);
  const table = useRef<HTMLDivElement>(null);
  const showDraft = useMemo(() => (next: AutomationRules) => setDraft(next), []);
  const commitDraft = useMemo(
    () => (next: AutomationRules) => {
      setDraft(null);
      save(next);
    },
    [save],
  );
  const { dragged, grab } = useRowDrag(table, rules, showDraft, commitDraft);
  const edited = !sameRules(saved, DEFAULT_RULES);

  if (failed && !loaded) return <div className="text-xs text-destructive">Не удалось загрузить правила.</div>;

  let index = 0;
  return (
    <div className="flex flex-col gap-3">
      <div ref={table} role="table" aria-label="Триггеры и действия" aria-busy={!loaded || undefined} className="@container flex flex-col gap-px overflow-visible [&>*:first-child]:rounded-t-lg [&>*:last-child]:rounded-b-lg">
        {/* "Когда" starts at the row's left edge, over the number column, level with the group titles. */}
        <div role="row" className="hidden grid-cols-[28px_minmax(0,1fr)_20px_minmax(0,1.4fr)_28px] gap-2 bg-surface-recessed-solid py-1 pl-3 pr-2 text-[11px] text-muted-foreground @[40rem]:grid">
          <span role="columnheader" className="col-span-2">
            Когда
          </span>
          <span />
          <span role="columnheader" className="-ml-2">
            Что сделать
          </span>
          <span />
        </div>
        {RULE_GROUPS.map(({ group, label }) => {
          const members = rules.rules.filter((rule) => ruleGroup(rule) === group);
          if (members.length === 0) return null;
          return [
            <div key={`group-${group}`} role="row" className="bg-surface-recessed-solid px-3 pb-1 pt-3 text-[11px] text-muted-foreground">
              {label}
            </div>,
            ...members.map((rule) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                index={index++}
                dragging={dragged === rule.id}
                focus={focus}
                onGrab={() => grab(rule.id)}
                onFocus={(id) => setFocus(focus === id ? null : id)}
                onChange={(next) => save(withRule(rules, rule.id, () => next))}
                onDelete={() => save({ version: 1, rules: rules.rules.filter((r) => r.id !== rule.id) })}
              />
            )),
          ];
        })}
        <div className="flex items-center bg-surface-recessed-solid py-2 pl-9 pr-2">
          <button
            type="button"
            onClick={() => save({ version: 1, rules: [...rules.rules, { id: newRuleId(), triggers: [], actions: [] }] })}
            className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] text-muted-foreground hover:bg-state-hover hover:text-foreground"
          >
            <Icon name="Plus" aria-hidden="true" className="size-3.5" />
            Добавить строку
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>
          {edited ? "Изменено относительно поведения по умолчанию" : "Поведение по умолчанию"}
          {failed && loaded && <span className="text-destructive"> · не удалось сохранить</span>}
        </span>
        {edited && (
          <button type="button" onClick={() => save(DEFAULT_RULES)} className="h-7 rounded-md bg-card px-2.5 text-[13px] text-foreground hover:bg-state-hover">
            Вернуть по умолчанию
          </button>
        )}
      </div>
    </div>
  );
}
