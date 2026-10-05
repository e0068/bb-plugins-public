// Этапы и бюджет брифа одной таблицей, всегда раскрытой: подписи колонок
// сверху — этап, риск, время, цель, потолок; строки этапов, уже потраченного и
// вариантов с ценой; под ними итог: карандаш в его колонке галочек
// открывает правку своей цены прямо в числах итога. Слева от вертикальной полосы —
// этап; у этапа с выбором исполнителя (во Flow добавлен кто-то кроме Main
// Agent) исполнитель стоит сразу за названием с шевроном, и нажатие на эту
// часть строки раскрывает под ней исполнителей строками со своей ценой.
// Справа — колонка чекбоксов, как в прогресс-баре: этап в прогоне отмечен,
// снятый — пустой квадрат и ни одного числа; пройденный этап — галочка без
// чекбокса. Вертикальных полос нет. На узкой карточке строка встаёт в две
// линии: этап сверху, числа под ним, между ними — линия от подписи до
// колонки чекбоксов.
import { Fragment, useState, type ReactNode } from "react";

import { SELF, executorLabel, stageAdd, stageExecutorIds, stageItems, stageLabel, stagePhase, type StageItem } from "../core/stages";
import { criterionTitle, forecast, minutesText, money, ownDollars, plannedMinutes, scopeOf, spentLines, type Forecast, type ForecastLine } from "../core/budget";
import { optionRemoved, removedCriteria } from "../core/option-criteria";
import type { FileRoots } from "../core/result-link";
import { Icon } from "../components/ui/icon";
import type { Locale } from "../lib/i18n";
import { messages } from "../lib/messages";
import { stageKindOf } from "../lib/stage-constants";
import { cn } from "../lib/utils";
import type { DecisionBrief, StageExecutor } from "../shared/contract";
import { DocumentName, RiskText } from "./cells";
import { pickStageExecutor, restoreOwnBudget, seedOwnBudget, setOwnBudget, stageChoiceIn, toAnswer, toggleCriterion, toggleStageRun, typedOwnPrice, type Draft } from "./draft";
import { LinkedText } from "./linked-text";
import { useLocale, useMessages } from "./locale-context";
import { ExecutorMark } from "./provider-logos";
import { ResultRow } from "./result-row";
import { StageCheckbox } from "./stage-checkbox";
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

/** Строка таблицы: строки разделены не линиями, а тёмными разрывами между ними — как кнопки под таблицей. */
const ROW = `${GRID} bg-surface-recessed-solid`;

/** Подложка-кнопка во всю строку: наведение подсвечивает строку целиком, а ссылки и чекбокс поверх неё нажимаются сами. */
const OVERLAY = "absolute inset-0 enabled:hover:bg-state-hover disabled:cursor-default";

/** Левая часть строки: на узкой карточке занимает обе линии до чекбокса, на широкой — две первые колонки, до чисел. */
const LEFT = "col-start-1 col-end-7 row-start-1 row-end-3 flex min-w-0 items-center gap-2.5 py-2.5 pl-3 pr-2.5 text-left @[34rem]:col-end-3 @[34rem]:row-end-2 @[34rem]:py-1.5";

/** Числа: вторая линия на узкой карточке, первая — на широкой, где по вертикали стоят по центру строки, как чекбокс; риск на узкой прижат влево, под начало подписи. */
const NUM = "row-start-2 pt-2 pb-2.5 pr-2.5 text-right tabular-nums leading-5 @[34rem]:row-start-1 @[34rem]:self-center @[34rem]:py-1.5 pointer-events-none relative";
const CELLS = {
  risk: "col-start-2 text-left @[34rem]:col-start-3 @[34rem]:text-right",
  minutes: "col-start-3 @[34rem]:col-start-4",
  // Все числа по правому краю колонки: цель прижата к тире, потолок — к колонке галочек.
  target: "col-start-4 pr-1.5 @[34rem]:col-start-5",
  dash: "col-start-5 pr-0 text-center text-muted-foreground @[34rem]:col-start-6",
  max: "col-start-6 pl-1.5 pr-0 @[34rem]:col-start-7",
} as const;

/** Линия между подписью и числами на узкой карточке: от начала подписи, значок отделяет её от края, до колонки чекбоксов. */
const RULE = "col-start-2 col-end-7 row-start-2 self-start border-t border-border pointer-events-none @[34rem]:hidden";

/** Колонка чекбоксов: на узкой карточке во всю высоту двух линий. */
const BOX = "col-start-7 row-start-1 row-end-3 flex items-center justify-center @[34rem]:col-start-8 @[34rem]:row-end-2";

const sign = (n: number): string => (n < 0 ? "–" : "+");

/** Время строки: уже потраченное и основа итога — без знака, добавка — со знаком. */
const minutesCell = (minutes: number | null | undefined, plain: boolean, locale: Locale): string =>
  minutes === null || minutes === undefined ? "" : plain ? minutesText(minutes, locale) : `${sign(minutes)}${minutesText(Math.abs(minutes), locale)}`;

/** Деньги строки: основа — без знака, добавка — со знаком; неизвестные — прочерк. */
const moneyCell = (n: number | null, plain: boolean): string => (n === null ? "—" : plain ? money(n) : `${sign(n)}${money(Math.abs(n))}`);

type Budget = Draft["budget"];

/** Правка своей цены в «Итого»: своя цена до карандаша — её вернёт Esc — и то, что стоит в полях. */
type PriceEdit = { before: Budget; shown: Budget };

type Price = { minutes?: number | null | undefined; risk: number; target: number | null; max: number | null };

/** Четыре числа строки и тире между целью и потолком. */
function Numbers({ price, plain }: { price: Price; plain: boolean }) {
  const locale = useLocale();
  return (
    <>
      <span aria-hidden="true" className={RULE} />
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

/**
 * Подпись строки: название, пометка и то, что стоит справа, — исполнитель или результат; `numbers` оставляет место под числа второй линии.
 * `oneLine` — строка этапа: исполнитель или результат не переносится под название, а сжимается в той же линии.
 */
function Label({ icon, children, side, numbers, indent = false, oneLine = false }: { icon: ReactNode; children: ReactNode; side?: ReactNode; numbers: boolean; indent?: boolean; oneLine?: boolean }) {
  return (
    <>
      <span className="flex w-4 shrink-0 justify-center">{icon}</span>
      <span className={cn("flex min-w-0 flex-1 flex-col", indent && "pl-4")}>
        <span className={cn("flex min-w-0 items-center gap-x-2 gap-y-0.5 leading-5", !oneLine && "flex-wrap")}>
          {children}
          {side !== undefined && <span className="flex min-w-0 items-center gap-1">{side}</span>}
        </span>
        {/* Высота второй линии с отступами над линией и под ней: подпись не налезает на линию, числа — на подпись. */}
        {numbers && <span aria-hidden="true" className="h-9 @[34rem]:hidden" />}
      </span>
    </>
  );
}

/** Галочка без чекбокса, как у пройденного этапа в прогресс-баре. */
const Check = () => <Icon name="Check" aria-hidden="true" className="size-3.5" />;

/** Значок исполнителя: у агента — логотип провайдера, у workflow — свой; у Main Agent — робот. */
function ExecutorIcon({ executor }: { executor: StageExecutor | undefined }) {
  return executor === undefined ? <Icon name="Bot" aria-hidden="true" className="size-3.5 shrink-0" /> : <ExecutorMark executor={executor} className="size-3.5 shrink-0" />;
}

function useExecutorName() {
  const t = useMessages();
  const locale = useLocale();
  return (item: StageItem, id: string): string => (id === SELF ? t.settings.mainAgent : executorLabel(item.stage, id, locale));
}

/** Свёртка строк под этапом — у Definition of Done это его пункты: строка этапа их прячет и показывает. */
type Fold = { open: boolean; toggle: () => void };

const Chevron = ({ open }: { open: boolean }) => <Icon name="ChevronDown" aria-hidden="true" className={cn("size-3.5 shrink-0 text-muted-foreground", open && "rotate-180")} />;

/** Подложка-кнопка свёртки во всю строку: смотреть пункты можно и в отвеченном брифе, поэтому она не гаснет. */
const FoldButton = ({ fold, name }: { fold: Fold; name: string }) => <button type="button" aria-expanded={fold.open} aria-label={name} onClick={fold.toggle} className={OVERLAY} />;

/** `line` — цена этапа в прогоне из прогноза; снятый этап зачёркнут и чисел не несёт. */
function StageRows({ item, view, scope, priced, line, roots, fold }: { item: StageItem; view: StagesTableView; scope: ReturnType<typeof scopeOf>; priced: boolean; line: ForecastLine | undefined; roots: FileRoots | null; fold?: Fold }) {
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
        oneLine
        side={
          first === undefined ? (
            fold === undefined ? undefined : <Chevron open={fold.open} />
          ) : (
            <>
              <DocumentName link={first} roots={roots} className="pointer-events-auto self-center" />
              {results.length > 1 && <span className="shrink-0 text-[11px] text-muted-foreground">+{results.length - 1}</span>}
              {expandable && <Icon name="ChevronDown" aria-hidden="true" className={cn("size-3.5 shrink-0 text-muted-foreground", open && "rotate-180")} />}
            </>
          )
        }
      >
        <span className="shrink-0">{name}</span>
      </Label>
    );
    return (
      <>
        <div data-stage={item.stage.id} className={cn(ROW, "relative")}>
          {/* Подложка-кнопка стоит под подписью, а не вокруг неё: ссылка результата поверх открывает файл и строку не раскрывает. */}
          {expandable ? (
            <button type="button" aria-expanded={open} aria-label={name} disabled={view.sending} onClick={(e) => toggle(e.currentTarget)} className={OVERLAY} />
          ) : (
            fold !== undefined && <FoldButton fold={fold} name={name} />
          )}
          <div className={cn(LEFT, "pointer-events-none relative")}>{label}</div>
          <span role="img" aria-label={t.stages.done} className={cn(BOX, "pointer-events-none relative")}>
            <Check />
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
  const price: Price | undefined = priced && choice.run ? line : undefined;
  const executor = item.stage.executors.find((e) => e.id === choice.executor);
  const dim = !choice.run && "opacity-40";
  const label = (
    <Label
      icon={<span className={cn("flex", dim)}>{icon}</span>}
      numbers={price !== undefined}
      indent={indent}
      oneLine
      side={
        choosable ? (
          <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <ExecutorIcon executor={executor} />
            <span className="min-w-0 truncate">{nameOf(item, choice.executor)}</span>
            {clickable && <Icon name="ChevronDown" aria-hidden="true" className={cn("size-3.5 shrink-0", open && "rotate-180")} />}
          </span>
        ) : fold === undefined ? undefined : (
          <Chevron open={fold.open} />
        )
      }
    >
      <span className={cn("shrink-0", !choice.run && "text-muted-foreground line-through", dim)}>{name}</span>
    </Label>
  );
  return (
    <>
      <div data-stage={item.stage.id} className={cn(ROW, "relative")}>
        {clickable ? (
          <button type="button" aria-expanded={open} aria-label={t.stages.executorGroup(name)} disabled={view.sending} onClick={(e) => toggle(e.currentTarget)} className={OVERLAY} />
        ) : (
          fold !== undefined && <FoldButton fold={fold} name={name} />
        )}
        <div className={cn(LEFT, "pointer-events-none relative")}>{label}</div>
        {price !== undefined && <Numbers price={price} plain={false} />}
        <span className={cn(BOX, "relative")}>
          <StageCheckbox
            inRun={choice.run}
            label={owner === undefined ? t.stages.toRun(name) : t.subStages.inRun(name, stageLabel(owner, t.stages))}
            disabled={view.sending}
            // Под-этап включается и выключается только вместе с владельцем: его чекбокс показывает, но не нажимается.
            onToggle={view.answered || owner !== undefined ? null : () => view.stageChange((d) => toggleStageRun(view.brief, d, item))}
          />
        </span>
      </div>
      {open && clickable && <ExecutorRows item={item} view={view} scope={scope} priced={priced} chosen={choice.executor} />}
    </>
  );
}

/**
 * Исполнители раскрытого этапа строками — светлее строк этапов, с теми же тёмными разрывами; вся строка — кнопка выбора,
 * галочка выбранного — в колонке чекбоксов. Светлая подложка полупрозрачная, поэтому лежит на непрозрачной строке таблицы.
 */
function ExecutorRows({ item, view, scope, priced, chosen }: { item: StageItem; view: StagesTableView; scope: ReturnType<typeof scopeOf>; priced: boolean; chosen: string }) {
  const t = useMessages();
  const nameOf = useExecutorName();
  const recommended = item.report?.executor ?? SELF;
  return (
    <div role="group" aria-label={t.stages.executorGroup(stageLabel(item.stage, t.stages))} className="flex flex-col gap-px">
      {stageExecutorIds(item.stage).map((id) => {
        const executor = item.stage.executors.find((e) => e.id === id);
        const price = priced ? stageAdd(item, id, scope) : undefined;
        const on = id === chosen;
        return (
          <div key={id} className="bg-surface-recessed-solid">
          <button
            type="button"
            aria-pressed={on}
            disabled={view.sending}
            onClick={(e) => {
              view.stageChange((d) => pickStageExecutor(d, item, id));
              view.expand(null, e.currentTarget);
            }}
            className={cn(GRID, "w-full bg-state-hover text-left enabled:hover:bg-state-active disabled:cursor-default [&_*]:border-foreground/15")}
          >
            <span className={LEFT}>
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
            </span>
            {price !== undefined && <Numbers price={price} plain={false} />}
            <span className={BOX}>{on && <Check />}</span>
          </button>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Пункты Definition of Done под его строкой, без лишнего отступа: название — текст пункта, цена — его строка прогноза,
 * а у брифа с этапом самой работы, где строки пункта нет, — цена самого пункта. Чекбокс снимает и возвращает пункт так же,
 * как крестик в секции Definition of Done; пункт, снятый выбранным вариантом, вернуть можно только сменой выбора.
 */
function CriterionRows({ view, lines, priced }: { view: StagesTableView; lines: ReadonlyMap<number, ForecastLine>; priced: boolean }) {
  const t = useMessages();
  const answer = toAnswer(view.brief, view.draft);
  const removed = removedCriteria(view.brief, answer);
  const byOption = optionRemoved(view.brief, answer);
  return (view.brief.setup?.criteria ?? []).map((item, i) => {
    const kept = !removed.includes(i);
    const own = typeof item === "string" ? undefined : item.add;
    const line: Price | undefined = priced && kept ? (lines.get(i) ?? own) : undefined;
    return (
      <div key={`criterion-${i}`} data-criterion={i} className={ROW}>
        <div className={LEFT}>
          <Label icon={null} numbers={line !== undefined}>
            <span className={cn("min-w-0", !kept && "text-muted-foreground line-through opacity-40")}>
              <LinkedText text={criterionTitle(item)} />
            </span>
          </Label>
        </div>
        {line !== undefined && <Numbers price={line} plain={false} />}
        <span className={BOX}>
          <StageCheckbox inRun={kept} label={t.brief.item(i + 1)} disabled={view.sending} onToggle={view.answered || byOption.includes(i) ? null : () => view.change((d) => toggleCriterion(d, i))} />
        </span>
      </div>
    );
  });
}

/** Строки прогноза по номерам пунктов; снимок, записанный до меток, узнаёт строку пункта по подписи «Пункт N». */
const criterionLinesIn = (f: Forecast, count: number, snapshot: boolean, locale: Locale): Map<number, ForecastLine> => {
  const lines = f.lines.slice(spentLines(f));
  const byLabel = snapshot && !lines.some((l) => l.criterion !== undefined);
  const label = messages(locale).budget.item;
  return new Map(
    Array.from({ length: count }, (_, i) => [i, lines.find((l) => (byLabel ? l.label === label(i + 1) : l.criterion === i))] as const).flatMap(([i, l]) => (l === undefined ? [] : [[i, l] as const])),
  );
};

/** Строка прогноза без своего этапа: уже потраченное, вариант вопроса, утверждённый бюджет прогона. */
function LineRow({ line, plain, done }: { line: ForecastLine; plain: boolean; done: boolean }) {
  // У потраченного пометки нет: что оно потрачено, говорят часы и галочка, а минуты и так стоят в колонке времени.
  const note = done ? "" : line.note;
  return (
    <div data-line className={ROW}>
      <div className={LEFT}>
        <Label icon={done ? <Icon name="Clock" aria-hidden="true" className="size-3.5" /> : null} numbers>
          <span className="min-w-0">{line.label}</span>
          {note !== "" && <span className="min-w-0 text-[11px] text-muted-foreground">{note}</span>}
        </Label>
      </div>
      <Numbers price={line} plain={plain} />
      <span className={BOX}>{done && <Check />}</span>
    </div>
  );
}

/**
 * Поле своей цены с маской: деньги — «$» перед числом, до двух знаков после точки; время — целые минуты с «мин» после.
 * Цифры стоят там же, где числа итога без правки: поле выступает в отступ ячейки и не растит строку.
 */
function MaskField({ kind, value, label, disabled, onChange }: { kind: "money" | "minutes"; value: string; label: string; disabled: boolean; onChange: (text: string) => void }) {
  const t = useMessages();
  const clean = (text: string): string => {
    if (kind === "minutes") return text.replace(/\D/g, "");
    const [whole = "", ...rest] = text.replace(/[^\d.]/g, "").split(".");
    return rest.length === 0 ? whole : `${whole}.${rest.join("").slice(0, 2)}`;
  };
  const fix = cn("shrink-0", value === "" ? "text-muted-foreground" : "text-foreground");
  return (
    <label className="-my-1 -mr-1.5 flex h-7 cursor-text items-center justify-end rounded-md bg-card px-1.5 font-normal focus-within:ring-1 focus-within:ring-border">
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
  // Пункты Definition of Done встают под его строку и сворачиваются ею; без такого этапа их цены идут отдельными строками, как раньше.
  const criteriaStage = items.find((item) => stageKindOf(item.stage) === "criteria")?.stage.id;
  const criterionLines = criteriaStage === undefined ? new Map<number, ForecastLine>() : criterionLinesIn(total, view.brief.setup?.criteria?.length ?? 0, snapshot !== undefined, locale);
  const taken = new Set([...stageLines.values(), ...criterionLines.values()]);
  const [criteriaOpen, setCriteriaOpen] = useState(true);
  const criteriaFold: Fold = { open: criteriaOpen, toggle: () => setCriteriaOpen((was) => !was) };
  // Свёртка нужна, только когда есть что сворачивать.
  const foldable = (view.brief.setup?.criteria?.length ?? 0) > 0;
  const others = total.lines.slice(spent).filter((l) => !taken.has(l));
  const own = view.draft.budget;
  const planned = plannedMinutes(total);
  const ownCell = (text: string, kind: "money" | "minutes", forecastValue: string) => (text.trim() === "" ? forecastValue : kind === "money" ? `$${ownDollars(text)}` : minutesText(Number(text), locale));
  // Числа прогноза так, как их набрал бы владелец: без «$» и «мин».
  const forecastPrice: Budget = { minutes: planned === null ? "" : String(planned), target: ownDollars(money(total.target)), max: ownDollars(money(total.max)) };
  const [edit, setEdit] = useState<PriceEdit | null>(null);
  const editing = edit !== null && !view.answered;
  const type = (field: keyof Budget, text: string) => {
    setEdit((was) => (was === null ? was : { ...was, shown: { ...was.shown, [field]: text } }));
    view.change((d) => setOwnBudget(d, field, typedOwnPrice(text, forecastPrice[field])));
  };
  const cancel = () => {
    if (edit !== null) view.change((d) => restoreOwnBudget(d, edit.before));
    setEdit(null);
  };
  // Клавиши ловит вся строка: Esc срабатывает и тогда, когда фокус остался на галочке.
  const onKey = (key: string) => (!editing ? undefined : key === "Enter" ? setEdit(null) : key === "Escape" ? cancel() : undefined);
  const priceCell = (field: keyof Budget, kind: "money" | "minutes", label: string, shown: string) =>
    editing ? <MaskField kind={kind} value={edit.shown[field]} label={label} disabled={view.sending} onChange={(text) => type(field, text)} /> : shown;
  const head = "row-start-1 py-1.5 pr-2.5 text-right text-[11px] font-normal text-muted-foreground";
  return (
    <div role="group" aria-label={t.brief.stagesTable} className="@container flex flex-col gap-px text-xs">
      <div className={ROW}>
        <span className="col-start-1 col-end-3 row-start-1 hidden py-1.5 pl-3 text-[11px] text-muted-foreground @[34rem]:block">{t.brief.stage}</span>
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
        <Fragment key={item.stage.id}>
          <StageRows item={item} view={view} scope={scope} priced={priced} line={stageLines.get(item.stage.id)} roots={roots} fold={item.stage.id === criteriaStage && foldable ? criteriaFold : undefined} />
          {item.stage.id === criteriaStage && criteriaFold.open && <CriterionRows view={view} lines={criterionLines} priced={priced} />}
        </Fragment>
      ))}
      {priced &&
        others.map((line, i) => (
          <LineRow key={`line-${i}`} line={line} plain={line.base === true} done={false} />
        ))}
      {priced && (
        <div data-total onKeyDown={(e) => onKey(e.key)} className={cn(ROW, "font-semibold")}>
          <div className={LEFT}>
            <Label icon={null} numbers>
              <span>{t.brief.total}</span>
            </Label>
          </div>
          <span aria-hidden="true" className={RULE} />
          <span className={cn(NUM, CELLS.risk)}>
            <RiskText risk={total.risk} />
          </span>
          <span className={cn(NUM, CELLS.minutes, editing && "pointer-events-auto")}>{priceCell("minutes", "minutes", t.brief.ownMinutes, ownCell(own.minutes, "minutes", planned === null ? "" : minutesText(planned, locale)))}</span>
          <span className={cn(NUM, CELLS.target, editing && "pointer-events-auto")}>{priceCell("target", "money", t.brief.ownTarget, ownCell(own.target, "money", money(total.target)))}</span>
          <span aria-hidden="true" className={cn(NUM, CELLS.dash)}>
            –
          </span>
          <span className={cn(NUM, CELLS.max, editing && "pointer-events-auto")}>{priceCell("max", "money", t.brief.ownMax, ownCell(own.max, "money", money(total.max)))}</span>
          <span className={BOX}>
            {!view.answered && (
              <button
                type="button"
                aria-label={editing ? t.brief.applyPrice : t.brief.editPrice}
                disabled={view.sending}
                onClick={() => setEdit(editing ? null : { before: own, shown: seedOwnBudget(own, forecastPrice) })}
                className="flex size-6 items-center justify-center rounded-md text-muted-foreground enabled:hover:bg-state-hover enabled:hover:text-foreground"
              >
                <Icon name={editing ? "Check" : "Edit"} aria-hidden="true" className="size-3.5" />
              </button>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
