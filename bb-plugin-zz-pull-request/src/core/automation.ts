// Layer 1 (core) — the plugin's machinery as data: which triggers exist, which
// actions exist, and the rules that bind them. A rule is one row of the
// settings table — trigger tags on the left, action tags on the right. On a
// trigger the plugin takes every rule holding it and runs their actions in
// rule order, then tag order (see ./automation-run.ts). Display is an action
// too, of three kinds the run itself never executes: a button (`show.*`,
// applied by the header's subscription, src/ui/header-button-state.tsx), a
// notification (`notify.*`, applied to a click's toasts, ./automation-notify.ts)
// and a thread status (`status.*`, the sidebar row icon, ./automation-status.ts).
//
// Imports nothing but zod: the front-end bundle imports this module, and a
// value pulled from the server SDK would break the plugin install.
import { z } from "zod";

export const TRIGGER_IDS = [
  "click.pr",
  "click.pr-merge",
  "click.pr-merge-archive",
  "click.merge",
  "click.merge-archive",
  "click.archive",
  "click.ff",
  "click.wake",
  "click.retry-main",
  "state.open",
  "state.env",
  "state.thread-pr",
  "state.poll",
  "outcome.pr-created",
  "outcome.merged",
  "outcome.mutated",
] as const;
export type TriggerId = (typeof TRIGGER_IDS)[number];
export type OutcomeTrigger = Extract<TriggerId, `outcome.${string}`>;
export type StateTrigger = Extract<TriggerId, `state.${string}`>;

export const ACTION_IDS = [
  "show.wake",
  "show.ff",
  "show.pr",
  "show.merge",
  "show.main-not-pulled",
  "show.archive",
  "status.uncommitted",
  "status.committed",
  "status.pr-open",
  "status.pr-checking",
  "status.pr-conflict",
  "status.pr-reviewed",
  "status.pr-merged",
  "notify.result",
  "notify.warnings",
  "notify.prompts",
  "notify.errors",
  "git.create-pr",
  "git.merge",
  "git.pull-main",
  "git.fast-forward",
  "files.bump-versions",
  "bb.tasks-in-review",
  "bb.tasks-done",
  "bb.archive",
  "bb.wake",
  "bb.reinstall",
  "bb.refresh",
] as const;
export type ActionId = (typeof ACTION_IDS)[number];
export type ShowActionId = Extract<ActionId, `show.${string}`>;
export type NotifyActionId = Extract<ActionId, `notify.${string}`>;
export type StatusActionId = Extract<ActionId, `status.${string}`>;
export type DisplayActionId = ShowActionId | NotifyActionId | StatusActionId;
export type DoActionId = Exclude<ActionId, DisplayActionId>;
export type ClickTrigger = Extract<TriggerId, `click.${string}`>;

export type TriggerGroup = "click" | "state" | "outcome";
export type RuleGroup = TriggerGroup | "none";
export type ActionDomain = "button" | "notify" | "status" | "git" | "files" | "bb";

/** Icon names from components/ui/icon.tsx — kept as strings so this module stays free of UI imports. */
export interface TriggerInfo {
  label: string;
  group: TriggerGroup;
  icon: "Target" | "Zap" | "Clock" | "CircleCheck";
}
export interface ActionInfo {
  label: string;
  domain: ActionDomain;
  /** For a display action: when it actually appears — a button checks this on every trigger of its row. */
  when?: string;
}

export const TRIGGERS: Readonly<Record<TriggerId, TriggerInfo>> = {
  "click.pr": { label: "Pull Request", group: "click", icon: "Target" },
  "click.pr-merge": { label: "Pull Request then Merge", group: "click", icon: "Target" },
  "click.pr-merge-archive": { label: "Pull Request, Merge then Archive", group: "click", icon: "Target" },
  "click.merge": { label: "Merge", group: "click", icon: "Target" },
  "click.merge-archive": { label: "Merge then Archive", group: "click", icon: "Target" },
  "click.archive": { label: "Done & Archive", group: "click", icon: "Target" },
  "click.ff": { label: "Fast Forward", group: "click", icon: "Target" },
  "click.wake": { label: "Wake Up", group: "click", icon: "Target" },
  "click.retry-main": { label: "main not pulled → Retry", group: "click", icon: "Target" },
  "state.open": { label: "Шапка треда открыта", group: "state", icon: "Zap" },
  "state.env": { label: "Git окружения изменился", group: "state", icon: "Zap" },
  "state.thread-pr": { label: "bb обновил PR треда", group: "state", icon: "Zap" },
  "state.poll": { label: "Каждые 20 с", group: "state", icon: "Clock" },
  "outcome.pr-created": { label: "PR создан", group: "outcome", icon: "CircleCheck" },
  "outcome.merged": { label: "PR смёрджен", group: "outcome", icon: "CircleCheck" },
  "outcome.mutated": { label: "Действие изменило тред", group: "outcome", icon: "CircleCheck" },
};

export const ACTIONS: Readonly<Record<ActionId, ActionInfo>> = {
  "show.wake": { label: "Wake Up", domain: "button", when: "окружение застряло в retiring" },
  "show.ff": { label: "Fast Forward", domain: "button", when: "ветка отстала от main" },
  "show.pr": { label: "Pull Request", domain: "button", when: "в ветке есть изменения, PR нет" },
  "show.merge": { label: "Merge", domain: "button", when: "PR открыт" },
  "show.main-not-pulled": { label: "main not pulled", domain: "button", when: "последний pull main провалился" },
  "show.archive": { label: "Done & Archive", domain: "button", when: "работа в main" },
  "status.uncommitted": { label: "Не закоммичено", domain: "status", when: "в дереве есть незакоммиченные правки" },
  "status.committed": { label: "Закоммичено", domain: "status", when: "ветка впереди базы и её содержимое не в базе" },
  "status.pr-open": { label: "PR открыт", domain: "status", when: "PR открыт или черновик, проверки не прошли или их нет" },
  "status.pr-checking": { label: "Идут проверки PR", domain: "status", when: "PR открыт, проверки идут" },
  "status.pr-conflict": { label: "Конфликт в PR", domain: "status", when: "PR открыт и конфликтует с базой" },
  "status.pr-reviewed": { label: "PR прошёл проверки", domain: "status", when: "PR открыт, проверки прошли" },
  "status.pr-merged": { label: "PR смёрджен", domain: "status", when: "PR смёрджен, тред ещё не открывали" },
  "notify.result": { label: "Итог", domain: "notify", when: "клик удался: что сделано, ссылка на PR" },
  "notify.warnings": { label: "Предупреждения", domain: "notify", when: "версия не поднята, плагин не переустановлен, задача не переведена" },
  "notify.prompts": { label: "Вопрос о репойнте", domain: "notify", when: "задетый плагин стоит не из git этого репозитория" },
  "notify.errors": { label: "Ошибки", domain: "notify", when: "GitHub отказал или шаг не прошёл" },
  "git.create-pr": { label: "Создать PR", domain: "git" },
  "git.merge": { label: "Смёрджить PR", domain: "git" },
  "git.pull-main": { label: "Подтянуть локальный main", domain: "git" },
  "git.fast-forward": { label: "Перемотать ветку на main", domain: "git" },
  "files.bump-versions": { label: "Поднять версии плагинов", domain: "files" },
  "bb.tasks-in-review": { label: "Задачи треда → in_review", domain: "bb" },
  "bb.tasks-done": { label: "Задачи треда → done", domain: "bb" },
  "bb.archive": { label: "Архивировать тред", domain: "bb" },
  "bb.wake": { label: "Разбудить тред", domain: "bb" },
  "bb.reinstall": { label: "Переустановить изменённые плагины", domain: "bb" },
  "bb.refresh": { label: "Обновить шапку", domain: "bb" },
};

export const DOMAIN_ICON: Readonly<Record<ActionDomain, "Eye" | "MessageSquare" | "Circle" | "GitBranch" | "FileText" | "AppWindow">> = {
  button: "Eye",
  notify: "MessageSquare",
  status: "Circle",
  git: "GitBranch",
  files: "FileText",
  bb: "AppWindow",
};

export const RULE_GROUPS: readonly { group: RuleGroup; label: string }[] = [
  { group: "click", label: "Нажатие кнопки" },
  { group: "state", label: "Состояние" },
  { group: "outcome", label: "Исход действия" },
  { group: "none", label: "Без триггера" },
];

export interface Rule {
  readonly id: string;
  readonly triggers: readonly TriggerId[];
  readonly actions: readonly ActionId[];
}
export interface AutomationRules {
  /** 2 is what is stored and answered; 1 is only ever read, and migrated (see parseRules). */
  readonly version: 1 | 2;
  readonly rules: readonly Rule[];
}

export const isShowAction = (id: ActionId): id is ShowActionId => id.startsWith("show.");
export const isNotifyAction = (id: ActionId): id is NotifyActionId => id.startsWith("notify.");
export const isStatusAction = (id: ActionId): id is StatusActionId => id.startsWith("status.");
export const isDisplayAction = (id: ActionId): id is DisplayActionId => isShowAction(id) || isNotifyAction(id) || isStatusAction(id);

/** Every state the sidebar row icon can take, as actions — also what the old single `show.row-glyph` stood for. */
export const STATUS_ACTION_IDS: readonly StatusActionId[] = ACTION_IDS.filter(isStatusAction);

const STATE_TRIGGERS: readonly TriggerId[] = ["state.open", "state.env", "state.thread-pr", "state.poll"];

/** The notifications each click showed before they became rules — the same toasts, kind by kind. */
const CLICK_NOTIFICATIONS: Readonly<Record<ClickTrigger, readonly NotifyActionId[]>> = {
  "click.pr": ["notify.result", "notify.warnings", "notify.errors"],
  "click.pr-merge": ["notify.result", "notify.warnings", "notify.prompts", "notify.errors"],
  "click.pr-merge-archive": ["notify.result", "notify.warnings", "notify.prompts", "notify.errors"],
  "click.merge": ["notify.result", "notify.warnings", "notify.prompts", "notify.errors"],
  "click.merge-archive": ["notify.result", "notify.warnings", "notify.prompts", "notify.errors"],
  "click.archive": ["notify.result", "notify.warnings", "notify.errors"],
  "click.ff": ["notify.result", "notify.errors"],
  "click.wake": ["notify.errors"],
  "click.retry-main": ["notify.result", "notify.errors"],
};

/** A button checks its condition on every state trigger of its row. */
const showRule = (show: ShowActionId): Rule => ({
  id: `state-show-${show.slice("show.".length)}`,
  triggers: STATE_TRIGGERS,
  actions: [show],
});

/** The row icon is polled by its own sidebar script, so the poll is the only trigger that reaches it. */
const STATUS_RULE_ID = "state-show-row-glyph";

const clickRule = (id: string, trigger: ClickTrigger, actions: readonly ActionId[]): Rule => ({
  id,
  triggers: [trigger],
  actions: [...actions, ...CLICK_NOTIFICATIONS[trigger]],
});

/** Today's machinery, row for row — the plugin behaves exactly as before the settings existed. */
export const DEFAULT_RULES: AutomationRules = {
  version: 2,
  rules: [
    clickRule("click-pr", "click.pr", ["git.create-pr", "bb.tasks-in-review"]),
    clickRule("click-pr-merge", "click.pr-merge", ["git.create-pr", "bb.tasks-in-review", "files.bump-versions", "git.merge"]),
    clickRule("click-pr-merge-archive", "click.pr-merge-archive", ["git.create-pr", "files.bump-versions", "git.merge", "bb.tasks-done", "bb.archive"]),
    clickRule("click-merge", "click.merge", ["files.bump-versions", "git.merge"]),
    clickRule("click-merge-archive", "click.merge-archive", ["files.bump-versions", "git.merge", "bb.tasks-done", "bb.archive"]),
    clickRule("click-archive", "click.archive", ["bb.tasks-done", "bb.archive"]),
    clickRule("click-ff", "click.ff", ["git.fast-forward"]),
    clickRule("click-wake", "click.wake", ["bb.wake"]),
    clickRule("click-retry-main", "click.retry-main", ["git.pull-main"]),
    showRule("show.wake"),
    showRule("show.ff"),
    showRule("show.pr"),
    showRule("show.merge"),
    showRule("show.main-not-pulled"),
    showRule("show.archive"),
    { id: STATUS_RULE_ID, triggers: ["state.poll"], actions: STATUS_ACTION_IDS },
    { id: "outcome-merged", triggers: ["outcome.merged"], actions: ["git.pull-main", "bb.reinstall"] },
    { id: "outcome-mutated", triggers: ["outcome.mutated"], actions: ["bb.refresh"] },
  ],
};

const LEGACY_GLYPH = "show.row-glyph";
const triggerSet: ReadonlySet<string> = new Set(TRIGGER_IDS);
const actionSet: ReadonlySet<string> = new Set(ACTION_IDS);

const rawSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  rules: z.array(
    z.object({
      id: z.string().min(1),
      triggers: z.array(z.string()),
      actions: z.array(z.string()),
    }),
  ),
});

const unique = <T>(list: readonly T[]): T[] => [...new Set(list)];

/**
 * Stored rules → rules the plugin can run. Ids this build does not know are
 * dropped (a rule saved by a newer build keeps what still makes sense); input
 * that is not rules at all falls back to the defaults. An empty list stays
 * empty — the owner removed everything on purpose.
 */
export function parseRules(input: unknown): AutomationRules {
  const parsed = rawSchema.safeParse(input);
  if (!parsed.success) return DEFAULT_RULES;
  const known = parsed.data.rules.map((r) => ({
    id: r.id,
    triggers: r.triggers.filter((t): t is TriggerId => triggerSet.has(t)),
    // The one sidebar glyph action became one status per icon state.
    actions: r.actions.flatMap((a): readonly string[] => (a === LEGACY_GLYPH ? STATUS_ACTION_IDS : [a])).filter((a): a is ActionId => actionSet.has(a)),
  }));
  return normalizeRules({ version: 2, rules: parsed.data.version === 1 ? migrateFromV1(known) : known });
}

/**
 * Version 1 had no notifications and one row showing every button and the
 * sidebar glyph. Its rows keep every edit; each click row gains the
 * notifications that click always showed, every button moves to a row of its
 * own with the same triggers, and the thread statuses to one row keeping only
 * the poll — the one trigger that reaches the icon.
 */
function migrateFromV1(rules: readonly Rule[]): Rule[] {
  return rules.flatMap((rule) => {
    const clicks = rule.triggers.filter((t): t is ClickTrigger => t.startsWith("click."));
    const notifications = clicks.flatMap((t) => CLICK_NOTIFICATIONS[t]);
    const shows = rule.actions.filter(isShowAction);
    const statuses = rule.actions.filter(isStatusAction);
    const moved = shows.length + statuses.length;
    const rest = [...rule.actions.filter((a) => !isShowAction(a) && !isStatusAction(a)), ...notifications];
    const split: Rule[] = [
      ...shows.map((show) => ({ id: `${rule.id}-${show.slice("show.".length)}`, triggers: rule.triggers, actions: [show] })),
      ...(statuses.length === 0
        ? []
        : [{ id: `${rule.id}-row-glyph`, triggers: rule.triggers.filter((t) => t === "state.poll"), actions: statuses }]),
    ];
    return moved === 0 || rest.length > 0 ? [{ ...rule, actions: rest }, ...split] : split;
  });
}

export const ruleGroup = (rule: Rule): RuleGroup => {
  const first = rule.triggers[0];
  return first === undefined ? "none" : TRIGGERS[first].group;
};

const groupRank = (group: RuleGroup): number => RULE_GROUPS.findIndex((g) => g.group === group);

/** Groups in table order (stable inside a group), repeated tags dropped. The order shown is the order run. */
export function normalizeRules(rules: AutomationRules): AutomationRules {
  const cleaned = rules.rules.map((r) => ({ id: r.id, triggers: unique(r.triggers), actions: unique(r.actions) }));
  const sorted = cleaned
    .map((rule, index) => ({ rule, index, rank: groupRank(ruleGroup(rule)) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((x) => x.rule);
  return { version: 2, rules: sorted };
}

/** Every action of every rule holding the trigger — rule order, then tag order, first occurrence wins. */
export function actionsFor(rules: AutomationRules, trigger: TriggerId): ActionId[] {
  return unique(rules.rules.filter((r) => r.triggers.includes(trigger)).flatMap((r) => r.actions));
}

/** The triggers under which a show action is on; empty means the button never shows. */
export function shownBy(rules: AutomationRules, action: ShowActionId): ReadonlySet<TriggerId> {
  return new Set(rules.rules.filter((r) => r.actions.includes(action)).flatMap((r) => r.triggers));
}

/** Moves a rule to `toIndex` of the whole list, clamped to its own group — a drag never changes a rule's group. */
export function moveRule(rules: AutomationRules, id: string, toIndex: number): AutomationRules {
  const from = rules.rules.findIndex((r) => r.id === id);
  if (from === -1) return rules;
  const moved = rules.rules[from]!;
  const group = ruleGroup(moved);
  const first = rules.rules.findIndex((r) => ruleGroup(r) === group);
  const last = rules.rules.length - 1 - [...rules.rules].reverse().findIndex((r) => ruleGroup(r) === group);
  const to = Math.min(Math.max(toIndex, first), last);
  const rest = rules.rules.filter((_, i) => i !== from);
  return { version: 2, rules: [...rest.slice(0, to), moved, ...rest.slice(to)] };
}

/** What is wrong with a rule, in words for the settings table. */
export function ruleProblems(rule: Rule): string[] {
  const problems: string[] = [];
  if (rule.triggers.length === 0 && rule.actions.length > 0) {
    problems.push("Нет триггера — действия этой строки никогда не выполнятся");
  }
  if (rule.actions.some(isStatusAction) && rule.triggers.some((t) => t !== "state.poll")) {
    problems.push("Статус треда обновляется только по «Каждые 20 с» — остальные триггеры строки на него не действуют");
  }
  if (rule.actions.some(isNotifyAction) && rule.triggers.length > 0 && !rule.triggers.some((t) => t.startsWith("click."))) {
    problems.push("Уведомления показываются только по нажатию кнопки — в этой строке нет клика");
  }
  const archive = rule.actions.indexOf("bb.archive");
  const merge = rule.actions.indexOf("git.merge");
  if (archive !== -1 && merge > archive) {
    problems.push("Архив стоит раньше мёрджа — тред уйдёт в архив, даже если мёрдж откажет");
  }
  return problems;
}

/** An archive with no merge before it must check the thread is ready before anything runs. */
export function archiveNeedsPreflight(actions: readonly ActionId[]): boolean {
  const archive = actions.indexOf("bb.archive");
  if (archive === -1) return false;
  return !actions.slice(0, archive).includes("git.merge");
}

export function sameRules(a: AutomationRules, b: AutomationRules): boolean {
  return JSON.stringify(normalizeRules(a)) === JSON.stringify(normalizeRules(b));
}

/** Realtime channel published after the rules are saved; the front-end store re-reads on it. */
export const AUTOMATION_RULES_CHANNEL = "automation-rules";

/** What made the server publish "changed": a state trigger, or the bb.refresh action. */
export type RepublishSource = "state.env" | "state.thread-pr" | "refresh";

/**
 * The source carried by a "changed" payload. Anything that is not one of the
 * two state triggers the server publishes counts as a refresh — which every
 * shown button obeys — so a payload from an older server never hides a change.
 */
export function republishSourceOf(payload: unknown): RepublishSource {
  const source = typeof payload === "object" && payload !== null ? (payload as { source?: unknown }).source : undefined;
  return source === "state.env" || source === "state.thread-pr" ? source : "refresh";
}
