// Кнопки этапов работ в нижнем блоке брифа. Ячейка невыполненного этапа — две
// кнопки: слева галочка с названием включает этап в прогон, справа шеврон
// раскрывает исполнителей. Сделанный этап — подложка во всю ячейку под
// ссылкой результата, без чекбокса: снять пройденный этап нельзя. Кнопки
// тянутся по ширине и переносятся, раскрытый список встаёт строкой сразу под
// рядом своей кнопки. Ячейка несделанной автоматизации — галочка с названием и
// значок автоматизации вместо шеврона: её исполняет сам Flow, поэтому ни
// исполнителя, ни цены у неё нет; сделанная ведёт себя как остальные этапы.
import { useRef, type ReactNode } from "react";

import { SELF, executorLabel, stageAdd, stageItems, stageLabel, stagePhase, type StageItem } from "../core/stages";
import { Icon } from "../components/ui/icon";
import { cn } from "../lib/utils";
import type { DecisionBrief, StageExecutor } from "../shared/contract";
import { AddMeta, CardText, CheckSquare, DocumentName, RESULT_ROW, type OpenFile } from "./cells";
import { pickStageExecutor, stageChoiceIn, toggleStageRun, type Draft } from "./draft";
import { useLocale, useMessages } from "./locale-context";
import { ROW_CELL, cellOrder, panelOrder, useRowEnds } from "./row-order";
import { automationIcon, stageIcon } from "./stage-icons";
import { copyText, useFlash } from "./flash";
import { ExecutorMark } from "./provider-logos";

export type StagesView = {
  brief: DecisionBrief;
  draft: Draft;
  answered: boolean;
  sending: boolean;
  change: (update: (draft: Draft) => Draft) => void;
  expanded: string | null;
  /** `anchor` — нажатая кнопка: раскрытие не сдвигает её на экране. */
  expand: (key: string | null, anchor?: Element | null) => void;
};

/** Ключ раскрытия кнопки этапа; у бюджета свой ключ в карточке. */
export const stageKey = (stageId: string): string => `stage:${stageId}`;

const rowCellAttr = { [ROW_CELL.slice(1, -1)]: "" };

/** Иконка исполнителя: у агента — логотип провайдера в квадрате, у workflow — своя; у «сам» иконки нет. */
function ExecutorIcon({ executor, className }: { executor: StageExecutor | undefined; className?: string }) {
  if (executor === undefined) return null;
  return <ExecutorMark executor={executor} className={cn("size-3.5 shrink-0", className)} />;
}

/** Этап старого брифа, ждавший приёмки, — тоже сделан. */
type StageState = { item: StageItem; finished: boolean };

const stateOf = (item: StageItem): StageState => ({ item, finished: stagePhase(item) !== "todo" });

function StageCell({ state, view, openFile, order, width }: { state: StageState; view: StagesView; openFile: OpenFile; order: number; width: number }) {
  const { item, finished } = state;
  const t = useMessages();
  const locale = useLocale();
  const cell = useRef<HTMLDivElement>(null);
  const choice = stageChoiceIn(view.brief, view.draft, item);
  const own = view.draft.stages[item.stage.id] ?? {};
  const key = stageKey(item.stage.id);
  const open = view.expanded === key;
  const checkable = !finished;
  const results = item.report?.results ?? [];
  const executor = item.stage.executors.find((e) => e.id === choice.executor);
  // Автоматизацию исполняет сам Flow: выбирать в ней нечего, поэтому у несделанной нечего и раскрывать.
  // Сделанная ведёт себя как остальные: ссылка результата в ячейке, остальные — в раскрытом списке.
  const automation = checkable ? item.stage.automation : undefined;
  const expandable = checkable ? automation === undefined && !view.answered : results.length > 0;
  const label = (
    <CardText
      label={<span className="min-w-0 truncate">{stageLabel(item.stage, t.stages)}</span>}
      meta={checkable ? <AddMeta add={stageAdd(item, choice.executor)} /> : null}
      bright={checkable ? own.executor !== undefined : true}
    >
      {automation !== undefined ? null : checkable ? (
        <span className="flex min-w-0 items-center gap-1">
          <ExecutorIcon executor={executor} />
          <span className="min-w-0 truncate">{executorLabel(item.stage, choice.executor, locale)}</span>
        </span>
      ) : (
        <span className="flex min-w-0 items-center gap-1">
          {results[0] !== undefined && <DocumentName link={results[0]} openFile={openFile} className="pointer-events-auto" />}
          {results.length > 1 && <span className="shrink-0 font-normal text-muted-foreground">+{results.length - 1}</span>}
        </span>
      )}
    </CardText>
  );
  const expand = () => view.expand(open ? null : key, cell.current);
  const style = { order, flex: `1 1 ${width}px`, minWidth: `min(${width}px, 100%)` };
  if (checkable)
    return (
      <div ref={cell} data-stage={item.stage.id} {...rowCellAttr} style={style} className={cn("flex min-h-11 bg-surface-recessed-solid", open && "bg-state-active")}>
        <button
          type="button"
          aria-pressed={choice.run}
          aria-label={t.stages.toRun(stageLabel(item.stage, t.stages))}
          disabled={view.answered || view.sending}
          onClick={() => view.change((d) => toggleStageRun(view.brief, d, item))}
          className={cn("flex min-w-0 flex-1 items-center gap-3 pl-3 text-left enabled:hover:bg-state-hover disabled:cursor-default", !expandable && automation === undefined && "pr-3")}
        >
          <CheckSquare on={choice.run} />
          {label}
        </button>
        {automation !== undefined && (
          // На месте шеврона — значок автоматизации: она идёт сама, нажимать не на что.
          <span role="img" aria-label={t.stages.automation} className="flex shrink-0 items-center px-3">
            <Icon name={automationIcon(automation)} aria-hidden="true" className="size-3.5 text-muted-foreground" />
          </span>
        )}
        {expandable && (
          // На месте шеврона — значок самого этапа, как у автоматизации: список
          // исполнителей за ним почти всегда из одного пункта «Сам», и обещать
          // подсветкой, что там что-то есть, — значит обещать лишнее. Нажатие
          // список по-прежнему раскрывает.
          <button
            type="button"
            aria-label={stageLabel(item.stage, t.stages)}
            aria-expanded={open}
            disabled={view.sending}
            onClick={expand}
            className="flex shrink-0 items-center px-3 disabled:cursor-default"
          >
            <Icon name={stageIcon(item.stage)} aria-hidden="true" className="size-3.5 text-muted-foreground" />
          </button>
        )}
      </div>
    );
  return (
    <div ref={cell} data-stage={item.stage.id} {...rowCellAttr} style={style} className="relative flex min-h-11 bg-surface-recessed-solid">
      {expandable ? (
        <button
          type="button"
          aria-label={stageLabel(item.stage, t.stages)}
          aria-expanded={open}
          disabled={view.sending}
          onClick={expand}
          className={cn("absolute inset-0 disabled:cursor-default", open ? "bg-state-active" : "hover:bg-state-hover")}
        />
      ) : (
        <span aria-hidden="true" className={cn("absolute inset-0", open && "bg-state-active")} />
      )}
      <div className="pointer-events-none relative flex min-w-0 flex-1 items-center justify-between gap-2 px-3">
        {label}
        <span role="img" aria-label={t.stages.done} className="flex shrink-0">
          <Icon name="Check" aria-hidden="true" className="size-4 text-foreground" />
        </span>
      </div>
    </div>
  );
}

/** Пункт раскрытого списка — в цвет активной кнопки, чтобы список не сливался с ячейками. */
const panelItem = "flex min-h-9 w-full items-center justify-between gap-3 bg-state-active px-3 py-2 text-left text-[13px]";
const panelHover = "enabled:hover:brightness-110 disabled:cursor-default";

/** `cell` — ячейка этапа: выбор сворачивает список, не сдвигая её на экране. */
function ExecutorPanel({ item, view, order, cell }: { item: StageItem; view: StagesView; order: number; cell: () => Element | null }) {
  const t = useMessages();
  const choice = stageChoiceIn(view.brief, view.draft, item);
  const recommended = item.report?.executor ?? SELF;
  const options: Array<{ id: string; executor: StageExecutor | undefined }> = [{ id: SELF, executor: undefined }, ...item.stage.executors.map((e) => ({ id: e.id, executor: e }))];
  return (
    <div role="group" aria-label={t.stages.executorGroup(stageLabel(item.stage, t.stages))} style={{ order }} className="flex basis-full flex-col gap-px">
      {options.map(({ id, executor }) => {
        const on = id === choice.executor;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={on}
            disabled={view.sending}
            onClick={() => {
              view.change((d) => pickStageExecutor(d, item, id));
              view.expand(null, cell());
            }}
            className={cn(panelItem, panelHover)}
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className={cn("flex min-w-0 items-center gap-1.5", on && "font-medium")}>
                {id === recommended && (
                  <>
                    <span aria-hidden="true" className="text-primary">
                      ✦
                    </span>
                    <span className="sr-only">{t.common.recommendationHint}</span>
                  </>
                )}
                <ExecutorIcon executor={executor} />
                <span className="min-w-0 truncate">{executor === undefined ? t.stages.self : executor.name}</span>
                {executor?.model !== undefined && <span className="shrink-0 text-[11px] font-normal text-muted-foreground">{executor.model}</span>}
              </span>
              {executor?.description !== undefined && <span className="line-clamp-1 text-[11px] text-muted-foreground">{executor.description}</span>}
            </span>
            <span className="flex shrink-0 items-center gap-3">
              <AddMeta add={executor === undefined ? undefined : item.report?.adds?.[id]} />
              {on && <Icon name="Check" aria-hidden="true" className="size-3.5" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Сколько держится «Путь скопирован» на месте пути. */
const COPIED_MS = 1500;

/** Результат одной строкой: имя открывает файл, путь за ним копируется в буфер и на миг сменяется подтверждением. */
export function ResultRow({ result, openFile, className }: { result: { label: string; target: string }; openFile: OpenFile; className?: string }) {
  const t = useMessages();
  const [copied, flashCopied] = useFlash(COPIED_MS);
  const [failed, flashFailed] = useFlash(COPIED_MS);
  const copy = copied ? "copied" : failed ? "failed" : null;
  const onCopy = () => void copyText(result.target).then(flashCopied, flashFailed);
  return (
    <div data-result-row className={cn(RESULT_ROW, className)}>
      <DocumentName link={result} openFile={openFile} className="max-w-[50%] shrink-0 self-center" />
      <button
        type="button"
        aria-label={t.stages.copyPath(result.target)}
        title={result.target}
        onClick={onCopy}
        className={cn("min-w-0 flex-1 truncate text-left font-mono text-[11px] hover:text-foreground", copy === "failed" ? "text-destructive" : copy === "copied" ? "text-success" : "text-muted-foreground")}
      >
        {copy === "copied" ? t.stages.copied : copy === "failed" ? t.stages.copyFailed : result.target}
      </button>
      <span role="status" className="sr-only">
        {copy === "copied" ? t.stages.copied : copy === "failed" ? t.stages.copyFailed : ""}
      </span>
    </div>
  );
}

function ResultsPanel({ item, openFile, order }: { item: StageItem; openFile: OpenFile; order: number }) {
  const t = useMessages();
  return (
    <div role="group" aria-label={t.stages.results(stageLabel(item.stage, t.stages))} style={{ order }} className="flex basis-full flex-col gap-px">
      {(item.report?.results ?? []).map((result) => (
        <ResultRow key={result.target} result={result} openFile={openFile} />
      ))}
    </div>
  );
}

/**
 * Кнопки этапов и бюджета одним переносимым рядом, списки — под рядом своей кнопки.
 * `budget` — кнопка бюджета и её раскрытая разбивка из карточки: они встают последней ячейкой ряда.
 */
export function StagesBlock({ view, openFile, budget }: { view: StagesView; openFile: OpenFile; budget: { key: string; cell: ReactNode; panel: ReactNode } | null }) {
  const container = useRef<HTMLDivElement>(null);
  const states = stageItems(view.brief).map(stateOf);
  const count = states.length + (budget === null ? 0 : 1);
  const ends = useRowEnds(container, count);
  const width = view.brief.stages?.minButtonWidth ?? 170;
  const panels = states.flatMap((state, index) => {
    const order = panelOrder(ends, index);
    const key = stageKey(state.item.stage.id);
    if (view.expanded !== key) return [];
    const cell = () => [...(container.current?.querySelectorAll<HTMLElement>("[data-stage]") ?? [])].find((el) => el.dataset.stage === state.item.stage.id) ?? null;
    return [state.finished ? <ResultsPanel key={key} item={state.item} openFile={openFile} order={order} /> : <ExecutorPanel key={key} item={state.item} view={view} order={order} cell={cell} />];
  });
  const budgetIndex = states.length;
  return (
    <div ref={container} className="flex flex-wrap gap-px">
      {states.map((state, index) => (
        <StageCell key={state.item.stage.id} state={state} view={view} openFile={openFile} order={cellOrder(index)} width={width} />
      ))}
      {budget !== null && (
        <div {...rowCellAttr} style={{ order: cellOrder(budgetIndex), flex: `1 1 ${width}px`, minWidth: `min(${width}px, 100%)` }} className="flex min-w-0">
          {budget.cell}
        </div>
      )}
      {panels}
      {budget !== null && view.expanded === budget.key && (
        <div style={{ order: panelOrder(ends, budgetIndex) }} className="flex basis-full flex-col">
          {budget.panel}
        </div>
      )}
    </div>
  );
}
