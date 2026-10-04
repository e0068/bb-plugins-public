// Этапы и бюджет брифа одной таблицей, всегда раскрытой: подписи колонок
// сверху — этап, риск, время, цель, потолок; строки этапов, уже потраченного и
// вариантов с ценой; под ними своя цена и итог. Слева от вертикальной полосы —
// этап; у этапа с выбором исполнителя (во Flow добавлен кто-то кроме Main
// Agent) исполнитель стоит справа с шевроном, и нажатие на эту часть строки
// раскрывает под ней исполнителей строками со своей ценой. Справа таблицу
// отрезает колонка галочек: этап, который можно взять в прогон, — белая
// ячейка с галочкой, снятый — погашенная; пройденный этап — две галочки.
// На узкой карточке строка встаёт в две линии: этап сверху, числа под ним.
import type { ReactNode } from "react";

import { SELF, executorLabel, stageAdd, stageExecutorIds, stageItems, stageLabel, stagePhase, type StageItem } from "../core/stages";
import { forecast, minutesText, money, ownDollars, plannedMinutes, scopeOf, spentLines, type Forecast, type ForecastLine } from "../core/budget";
import type { FileRoots } from "../core/result-link";
import { Icon } from "../components/ui/icon";
import type { Locale } from "../lib/i18n";
import { cn } from "../lib/utils";
import type { DecisionBrief, StageExecutor } from "../shared/contract";
import { DocumentName, RiskText } from "./cells";
import { pickStageExecutor, setOwnBudget, stageChoiceIn, toAnswer, toggleStageRun, type Draft } from "./draft";
import { useLocale, useMessages } from "./locale-context";
import { ExecutorMark } from "./provider-logos";
import { ResultRow } from "./result-row";
import { stageIcon } from "./stage-icons";
import { StageGlyph } from "./stage-glyph";

export type StagesTableView = {
  brief: DecisionBrief;
  draft: Draft;
  answered: boolean;
  sending: boolean;
  /** Правка выбора этапов; своя цена правится через `change`. */
  stageChange: (update: (draft: Draft) => Draft) => void;
  change: (update: (draft: Draft) => Draft) => void;
  expanded: string | null;
  /** `anchor` — нажатая часть строки: раскрытие не сдвигает её на экране. */
  expand: (key: string | null, anchor?: Element | null) => void;
};

/** Ключ раскрытия строки этапа: исполнители у несделанного, результаты у сделанного. */
export const stageKey = (stageId: string): string => `stage:${stageId}`;

/**
 * Колонки: этап (значок с отступом и подпись), риск, время, цель, тире, потолок, галочка 40 px.
 * Узкая карточка — числа второй линией под подписью, начиная с колонки подписи.
 */
// Лишняя высота двустрочной подписи уходит в первую линию: числа второй линии не наезжают на подпись.
const GRID = "grid grid-cols-[38px_minmax(0,.8fr)_minmax(0,1fr)_minmax(0,1fr)_10px_minmax(0,1fr)_40px] grid-rows-[1fr_auto] @[34rem]:grid-cols-[38px_minmax(0,1fr)_3rem_4.75rem_4.75rem_10px_4.75rem_40px] @[34rem]:grid-rows-[auto]";

/** Левая часть строки: на узкой карточке занимает обе линии до галочки, на широкой — две первые колонки, до вертикальной полосы. */
const LEFT = "col-start-1 col-end-7 row-start-1 row-end-3 flex min-w-0 items-center gap-2.5 py-2.5 pl-3 pr-2.5 text-left @[34rem]:col-end-3 @[34rem]:row-end-2 @[34rem]:border-r @[34rem]:border-border @[34rem]:py-1.5";

/** Числа: вторая линия на узкой карточке, первая — на широкой; риск на узкой прижат влево, под начало подписи. */
const NUM = "row-start-2 pb-2.5 pr-2.5 text-right tabular-nums leading-5 @[34rem]:row-start-1 @[34rem]:py-1.5 pointer-events-none";
const CELLS = {
  risk: "col-start-2 text-left @[34rem]:col-start-3 @[34rem]:text-right",
  minutes: "col-start-3 @[34rem]:col-start-4",
  target: "col-start-4 @[34rem]:col-start-5",
  dash: "col-start-5 pr-0 text-center text-muted-foreground @[34rem]:col-start-6",
  max: "col-start-6 @[34rem]:col-start-7",
} as const;

/** Колонка галочек, отрезанная полосой: на узкой карточке во всю высоту двух линий. */
const BOX = "col-start-7 row-start-1 row-end-3 flex items-stretch border-l border-border @[34rem]:col-start-8 @[34rem]:row-end-2";

const sign = (n: number): string => (n < 0 ? "–" : "+");

/** Время строки: уже потраченное и основа итога — без знака, добавка — со знаком. */
const minutesCell = (minutes: number | null | undefined, plain: boolean, locale: Locale): string =>
  minutes === null || minutes === undefined ? "" : plain ? minutesText(minutes, locale) : `${sign(minutes)}${minutesText(Math.abs(minutes), locale)}`;

/** Деньги строки: основа — без знака, добавка — со знаком; неизвестные — прочерк. */
const moneyCell = (n: number | null, plain: boolean): string => (n === null ? "—" : plain ? money(n) : `${sign(n)}${money(Math.abs(n))}`);

type Price = { minutes?: number | null | undefined; risk: number; target: number | null; max: number | null };

/** Четыре числа строки и тире между целью и потолком. */
function Numbers({ price, plain }: { price: Price; plain: boolean }) {
  const locale = useLocale();
  return (
    <>
      <span className={cn(NUM, CELLS.risk)}>
        <RiskText risk={price.risk} />
      </span>
      <span className={cn(NUM, CELLS.minutes)}>{minutesCell(price.minutes, plain, locale)}</span>
      <span className={cn(NUM, CELLS.target)}>{moneyCell(price.target, plain)}</span>
      <span aria-hidden="true" className={cn(NUM, CELLS.dash)}>
        –
      </span>
      <span className={cn(NUM, CELLS.max)}>{moneyCell(price.max, plain)}</span>
    </>
  );
}

/** Подпись строки: название, пометка и то, что стоит справа, — исполнитель или результат; `numbers` оставляет место под числа второй линии. */
function Label({ icon, children, side, numbers, indent = false }: { icon: ReactNode; children: ReactNode; side?: ReactNode; numbers: boolean; indent?: boolean }) {
  return (
    <>
      <span className="flex w-4 shrink-0 justify-center">{icon}</span>
      <span className={cn("flex min-w-0 flex-1 flex-col", indent && "pl-4")}>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 leading-5">
          {children}
          {side !== undefined && <span className="ml-auto flex min-w-0 items-center gap-1">{side}</span>}
        </span>
        {numbers && <span aria-hidden="true" className="h-5 @[34rem]:hidden" />}
      </span>
    </>
  );
}

const Check = ({ double = false, className }: { double?: boolean; className?: string }) => <Icon name={double ? "CheckDouble" : "Check"} aria-hidden="true" className={cn("size-4", className)} />;

/** Ячейка галочки «в прогоне»: белая, пока этап в прогоне, с той же галочкой, что у пройденного; снятый этап гасит белый. */
function RunBox({ on, label, disabled, onToggle }: { on: boolean; label: string; disabled: boolean; onToggle: (() => void) | null }) {
  if (onToggle === null)
    return <span className={cn(BOX, "items-center justify-center")}>{on && <Check />}</span>;
  return (
    <span className={BOX}>
      <button
        type="button"
        aria-pressed={on}
        aria-label={label}
        disabled={disabled}
        onClick={onToggle}
        className={cn("flex flex-1 items-center justify-center disabled:cursor-default", on ? "bg-white text-black enabled:hover:bg-white/85" : "enabled:hover:bg-state-hover")}
      >
        {on && <Check />}
      </button>
    </span>
  );
}

/** Значок исполнителя: у агента — логотип провайдера, у workflow — свой; у Main Agent — робот. */
function ExecutorIcon({ executor }: { executor: StageExecutor | undefined }) {
  return executor === undefined ? <Icon name="Bot" aria-hidden="true" className="size-3.5 shrink-0" /> : <ExecutorMark executor={executor} className="size-3.5 shrink-0" />;
}

function useExecutorName() {
  const t = useMessages();
  const locale = useLocale();
  return (item: StageItem, id: string): string => (id === SELF ? t.settings.mainAgent : executorLabel(item.stage, id, locale));
}

/** `line` — цена этапа в прогоне из прогноза; этап вне прогона показывает бледно, сколько добавит галочка. */
function StageRows({ item, view, scope, priced, line, roots }: { item: StageItem; view: StagesTableView; scope: ReturnType<typeof scopeOf>; priced: boolean; line: ForecastLine | undefined; roots: FileRoots | null }) {
  const t = useMessages();
  const nameOf = useExecutorName();
  const name = stageLabel(item.stage, t.stages);
  const key = stageKey(item.stage.id);
  const open = view.expanded === key;
  const finished = stagePhase(item) !== "todo";
  const icon = <StageGlyph icon={item.stage.icon} fallback={stageIcon(item.stage)} className="size-3.5" />;
  // Под-этап — своей строкой с отступом и своей галочкой; его галочка называет этап-владелец.
  const owner = item.stage.parent === undefined ? undefined : view.brief.stages?.list.find((stage) => stage.id === item.stage.parent);
  const indent = owner !== undefined;
  const toggle = (anchor: Element) => view.expand(open ? null : key, anchor);

  if (finished) {
    const results = item.report?.results ?? [];
    const first = results[0];
    const expandable = results.length > 0;
    const label = (
      <Label
        icon={icon}
        numbers={false}
        indent={indent}
        side={
          first === undefined ? undefined : (
            <>
              <DocumentName link={first} roots={roots} className="pointer-events-auto self-center" />
              {results.length > 1 && <span className="shrink-0 text-[11px] text-muted-foreground">+{results.length - 1}</span>}
              {expandable && <Icon name="ChevronDown" aria-hidden="true" className={cn("size-3.5 shrink-0 text-muted-foreground", open && "rotate-180")} />}
            </>
          )
        }
      >
        <span className="min-w-0">{name}</span>
      </Label>
    );
    return (
      <>
        <div data-stage={item.stage.id} className={GRID}>
          {/* Подложка-кнопка стоит под подписью, а не вокруг неё: ссылка результата поверх открывает файл и строку не раскрывает. */}
          <div className={cn(LEFT, "relative")}>
            {expandable && (
              <button type="button" aria-expanded={open} aria-label={name} disabled={view.sending} onClick={(e) => toggle(e.currentTarget)} className="absolute inset-0 enabled:hover:bg-state-hover disabled:cursor-default" />
            )}
            <span className="pointer-events-none relative flex min-w-0 flex-1 items-center gap-2.5">{label}</span>
          </div>
          <span role="img" aria-label={t.stages.done} className={cn(BOX, "items-center justify-center")}>
            <Check double />
          </span>
        </div>
        {open && (
          <div role="group" aria-label={t.stages.results(name)} className="flex flex-col gap-px">
            {results.map((result) => (
              <ResultRow key={result.target} result={result} roots={roots} />
            ))}
          </div>
        )}
      </>
    );
  }

  const choice = stageChoiceIn(view.brief, view.draft, item);
  const automation = item.stage.automation !== undefined;
  const ids = automation ? [] : stageExecutorIds(item.stage);
  // Выбор есть, только если во Flow этапу добавлен исполнитель кроме Main Agent; у снятого этапа его не видно.
  const choosable = ids.length > 1 && choice.run;
  const clickable = choosable && !view.answered;
  const price: Price | undefined = !priced ? undefined : (line ?? (choice.run ? undefined : stageAdd(item, choice.executor, scope)));
  const executor = item.stage.executors.find((e) => e.id === choice.executor);
  const dim = !choice.run && "opacity-40";
  const label = (
    <Label
      icon={<span className={cn("flex", dim)}>{icon}</span>}
      numbers={price !== undefined}
      indent={indent}
      side={
        choosable ? (
          <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <ExecutorIcon executor={executor} />
            <span className="min-w-0 truncate">{nameOf(item, choice.executor)}</span>
            {clickable && <Icon name="ChevronDown" aria-hidden="true" className={cn("size-3.5 shrink-0", open && "rotate-180")} />}
          </span>
        ) : undefined
      }
    >
      <span className={cn("min-w-0", !choice.run && "text-muted-foreground line-through", dim)}>{name}</span>
    </Label>
  );
  return (
    <>
      <div data-stage={item.stage.id} className={GRID}>
        {clickable ? (
          <button type="button" aria-expanded={open} aria-label={t.stages.executorGroup(name)} disabled={view.sending} onClick={(e) => toggle(e.currentTarget)} className={cn(LEFT, "enabled:hover:bg-state-hover disabled:cursor-default")}>
            {label}
          </button>
        ) : (
          <div className={LEFT}>{label}</div>
        )}
        {price !== undefined && (
          <span className={cn("contents", dim && "[&>*]:opacity-40")}>
            <Numbers price={price} plain={false} />
          </span>
        )}
        <RunBox on={choice.run} label={owner === undefined ? t.stages.toRun(name) : t.subStages.inRun(name, stageLabel(owner, t.stages))} disabled={view.sending} onToggle={view.answered ? null : () => view.stageChange((d) => toggleStageRun(view.brief, d, item))} />
      </div>
      {open && clickable && <ExecutorRows item={item} view={view} scope={scope} priced={priced} chosen={choice.executor} />}
    </>
  );
}

/** Исполнители раскрытого этапа строками — светлее строк этапов; галочка выбранного — в колонке галочек, без белой заливки. */
function ExecutorRows({ item, view, scope, priced, chosen }: { item: StageItem; view: StagesTableView; scope: ReturnType<typeof scopeOf>; priced: boolean; chosen: string }) {
  const t = useMessages();
  const nameOf = useExecutorName();
  const recommended = item.report?.executor ?? SELF;
  return (
    <div role="group" aria-label={t.stages.executorGroup(stageLabel(item.stage, t.stages))} className="flex flex-col divide-y divide-border border-t border-border">
      {stageExecutorIds(item.stage).map((id) => {
        const executor = item.stage.executors.find((e) => e.id === id);
        const price = priced ? stageAdd(item, id, scope) : undefined;
        const on = id === chosen;
        return (
          <div key={id} className={cn(GRID, "bg-state-hover")}>
            <button
              type="button"
              aria-pressed={on}
              disabled={view.sending}
              onClick={(e) => {
                view.stageChange((d) => pickStageExecutor(d, item, id));
                view.expand(null, e.currentTarget);
              }}
              className={cn(LEFT, "enabled:hover:bg-state-hover disabled:cursor-default")}
            >
              <Label icon={<ExecutorIcon executor={executor} />} numbers={price !== undefined}>
                <span className="flex min-w-0 flex-col">
                  <span className={cn("flex min-w-0 items-center gap-1.5", on && "font-medium")}>
                    {id === recommended && (
                      <>
                        <span aria-hidden="true" className="text-primary">
                          ✦
                        </span>
                        <span className="sr-only">{t.common.recommendationHint}</span>
                      </>
                    )}
                    <span className="min-w-0 truncate">{nameOf(item, id)}</span>
                  </span>
                  {executor?.description !== undefined && <span className="hidden text-[11px] leading-4 text-muted-foreground @[34rem]:line-clamp-1">{executor.description}</span>}
                </span>
              </Label>
            </button>
            {price !== undefined && <Numbers price={price} plain={false} />}
            <span className={cn(BOX, "items-center justify-center")}>{on && <Check />}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Строка прогноза без своего этапа: уже потраченное, вариант вопроса, утверждённый бюджет прогона. */
function LineRow({ line, plain, done }: { line: ForecastLine; plain: boolean; done: boolean }) {
  const t = useMessages();
  // У потраченного пометка — «уже потрачено»: минуты и так стоят в колонке времени.
  const note = done ? t.brief.spent : line.note;
  return (
    <div data-line className={GRID}>
      <div className={LEFT}>
        <Label icon={done ? <Icon name="Clock" aria-hidden="true" className="size-3.5" /> : null} numbers>
          <span className="min-w-0">{line.label}</span>
          {note !== "" && <span className="min-w-0 text-[11px] text-muted-foreground">{note}</span>}
        </Label>
      </div>
      <Numbers price={line} plain={plain} />
      <span className={cn(BOX, "items-center justify-center")}>{done && <Check double />}</span>
    </div>
  );
}

/** Поле своей цены с маской: деньги — «$» перед числом, до двух знаков после точки; время — целые минуты с «мин» после. */
function MaskField({ kind, value, label, disabled, onChange }: { kind: "money" | "minutes"; value: string; label: string; disabled: boolean; onChange: (text: string) => void }) {
  const t = useMessages();
  const clean = (text: string): string => {
    if (kind === "minutes") return text.replace(/\D/g, "");
    const [whole = "", ...rest] = text.replace(/[^\d.]/g, "").split(".");
    return rest.length === 0 ? whole : `${whole}.${rest.join("").slice(0, 2)}`;
  };
  const fix = cn("shrink-0", value === "" ? "text-muted-foreground" : "text-foreground");
  return (
    <label className="flex h-7 cursor-text items-center justify-end rounded-md bg-card px-1.5 focus-within:ring-1 focus-within:ring-border">
      {kind === "money" && <span className={fix}>$</span>}
      <input
        aria-label={label}
        inputMode={kind === "money" ? "decimal" : "numeric"}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(clean(e.target.value))}
        style={{ width: `${Math.max(1, value.length)}ch` }}
        className="shrink-0 border-0 bg-transparent p-0 text-right text-foreground outline-none"
      />
      {kind === "minutes" && <span className={cn(fix, "ml-1")}>{t.brief.minutesUnit}</span>}
    </label>
  );
}

/**
 * Строка прогноза, несущая цену этапа: по метке этапа. Только снимок, записанный до меток, узнаёт её по названию этапа —
 * живой прогноз без этапов в прогоне меток не несёт, и название этапа там могло бы совпасть с «Ревью» или «Вопрос 1».
 */
const stageLineIn = (f: Forecast, item: StageItem, snapshot: boolean): ForecastLine | undefined => {
  const lines = f.lines.slice(spentLines(f));
  const byName = snapshot && !lines.some((l) => l.stage !== undefined);
  return lines.find((l) => (byName ? l.label === item.stage.name : l.stage === item.stage.id));
};

/**
 * `snapshot` — прогноз, который владелец видел при отправке: отвеченный бриф показывает его, а не пересчёт.
 * `priced` — есть ли у брифа прогноз: без него таблица — одни этапы, без чисел, своей цены и итога.
 */
export function StagesTable({ view, roots, snapshot, priced }: { view: StagesTableView; roots: FileRoots | null; snapshot: Forecast | undefined; priced: boolean }) {
  const t = useMessages();
  const locale = useLocale();
  const answer = toAnswer(view.brief, view.draft);
  const total = snapshot ?? forecast(view.brief, answer, locale);
  const scope = scopeOf(view.brief, answer);
  const items = stageItems(view.brief);
  const spent = spentLines(total);
  // Цены этапов стоят в их строках; отдельными строками идёт только то, что этапа не имеет.
  const stageLines = new Map(items.flatMap((item) => (stagePhase(item) === "todo" ? [[item.stage.id, stageLineIn(total, item, snapshot !== undefined)] as const] : [])));
  const taken = new Set([...stageLines.values()]);
  const others = total.lines.slice(spent).filter((l) => !taken.has(l));
  const own = view.draft.budget;
  const planned = plannedMinutes(total);
  const ownCell = (text: string, kind: "money" | "minutes", forecastValue: string) => (text.trim() === "" ? forecastValue : kind === "money" ? `$${ownDollars(text)}` : minutesText(Number(text), locale));
  const head = "row-start-1 py-1.5 pr-2.5 text-right text-[11px] font-normal text-muted-foreground";
  return (
    <div role="group" aria-label={t.brief.stagesTable} className="@container flex flex-col divide-y divide-border bg-surface-recessed-solid text-xs">
      <div className={GRID}>
        <span className="col-start-1 col-end-3 row-start-1 hidden py-1.5 pl-3 text-[11px] text-muted-foreground @[34rem]:block @[34rem]:border-r @[34rem]:border-border">{t.brief.stage}</span>
        {priced && (
          <>
            <span className={cn(head, CELLS.risk)}>{t.brief.risk}</span>
            <span className={cn(head, CELLS.minutes)}>{t.brief.time}</span>
            <span className={cn(head, CELLS.target)}>{t.brief.target}</span>
            <span className={cn(head, CELLS.max)}>{t.brief.max}</span>
          </>
        )}
        <span className={cn(BOX, "row-end-2")} />
      </div>
      {total.lines.slice(0, spent).map((line, i) => (
        <LineRow key={`spent-${i}`} line={line} plain done />
      ))}
      {items.map((item) => (
        <StageRows key={item.stage.id} item={item} view={view} scope={scope} priced={priced} line={stageLines.get(item.stage.id)} roots={roots} />
      ))}
      {priced &&
        others.map((line, i) => (
          <LineRow key={`line-${i}`} line={line} plain={line.base === true} done={false} />
        ))}
      {priced && !view.answered && (
        <div className={GRID}>
          <div className={LEFT}>
            <Label icon={null} numbers>
              <span className="text-muted-foreground">{t.brief.ownPrice}</span>
            </Label>
          </div>
          <span className={cn(NUM, CELLS.minutes, "pointer-events-auto")}>
            <MaskField kind="minutes" value={own.minutes} label={t.brief.ownMinutes} disabled={view.sending} onChange={(text) => view.change((d) => setOwnBudget(d, "minutes", text))} />
          </span>
          <span className={cn(NUM, CELLS.target, "pointer-events-auto")}>
            <MaskField kind="money" value={own.target} label={t.brief.ownTarget} disabled={view.sending} onChange={(text) => view.change((d) => setOwnBudget(d, "target", text))} />
          </span>
          <span aria-hidden="true" className={cn(NUM, CELLS.dash, "self-center")}>
            –
          </span>
          <span className={cn(NUM, CELLS.max, "pointer-events-auto")}>
            <MaskField kind="money" value={own.max} label={t.brief.ownMax} disabled={view.sending} onChange={(text) => view.change((d) => setOwnBudget(d, "max", text))} />
          </span>
          <span className={BOX} />
        </div>
      )}
      {priced && (
        <div data-total className={cn(GRID, "font-semibold")}>
          <div className={LEFT}>
            <Label icon={null} numbers>
              <span>{t.brief.total}</span>
            </Label>
          </div>
          <span className={cn(NUM, CELLS.risk)}>
            <RiskText risk={total.risk} />
          </span>
          <span className={cn(NUM, CELLS.minutes)}>{ownCell(own.minutes, "minutes", planned === null ? "" : minutesText(planned, locale))}</span>
          <span className={cn(NUM, CELLS.target)}>{ownCell(own.target, "money", money(total.target))}</span>
          <span aria-hidden="true" className={cn(NUM, CELLS.dash)}>
            –
          </span>
          <span className={cn(NUM, CELLS.max)}>{ownCell(own.max, "money", money(total.max))}</span>
          <span className={BOX} />
        </div>
      )}
    </div>
  );
}
