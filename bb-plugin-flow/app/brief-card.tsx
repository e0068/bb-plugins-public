// Бриф нового вида — без рамки, шапки и подложек секций, во всю ширину ленты.
// Сверху вопросы: что непонятно, решается первым. Под ними «Готово, когда»
// пунктами, которые владелец снимает, правит и дописывает. Ниже — один блок
// стык в стык: артефакты, кнопки исполнителя, ревью, тестирования и бюджета,
// раскрытый выбор, поле «Добавить своё» и строка с отправкой. В ячейках блока
// значение тусклое, пока стоит рекомендация, и контрастное, когда его выбрал
// владелец; ✦ рекомендации — только в раскрытом списке.
// Отвеченный бриф рисуется теми же частями, без переключателей и полей: контрастно
// то, что владелец выбрал сам, а бюджет раскрывает снимок прогноза на момент отправки.
import { useState, type KeyboardEvent, type ReactNode } from "react";

import { deviationTotal, deviations } from "../core/answer-message";
import { requiredOf } from "../core/required";
import { changeOf, spentLines, criteriaSum, criterionEditable, criterionTitle, forecast, hasForecast, minutesText, money, ownBudgetText, plannedMinutes } from "../core/budget";
import { optionCriteria, optionRemoved, removedCriteria } from "../core/option-criteria";
import { DEFAULT_ROUTE, OFFERED_PLACES, ROUTE_BRANCHES, ROUTE_TREES, branchAllowed, withBranch, withTree } from "../core/places";
import { stageItems } from "../core/stages";
import { demoVerdict } from "../core/outcome";
import { REVIEW_ROWS, SETUP_ROW, artifactVerb, checkerAllowed, rowsOf } from "../core/rows";
import { Button } from "../components/ui/button";
import { Icon } from "../components/ui/icon";
import { cn } from "../lib/utils";
import type { Locale } from "../lib/i18n";
import type { AnswerRecord, Artifact, Criterion, DecisionBrief, DecisionOption, DecisionQuestion, DispatchPlace, DispatchRoute, RouteBranch, RouteTree } from "../shared/contract";
import {
  decidedCount,
  editCriterion,
  fromAnswer,
  hiddenIn,
  initialDraft,
  isPicked,
  pickOption,
  removeAddedCriterion,
  setAddedCriterion,
  setNote,
  setOwn,
  setOwnBudget,
  toAnswer,
  toggleCriterion,
  type Draft,
  setPlace,
  placeIn,
  setRoute,
  routeIn,
  settleDispatch,
  setOutcomeRework,
} from "./draft";
import { AddRow, addRowText } from "./add-row";
import { AttachmentThumbs, AttachmentsProvider, usePasteImages } from "./attachments";
import { AddMeta, CardText, CheckSquare, DocumentName, RiskText, buttonCard, type OpenFile } from "./cells";
import { answeredAt, useStoredDraft, useSubmit, type FormProps } from "./parts";
import type { Messages } from "../lib/messages";
import { useLocale, useMessages } from "./locale-context";
import { useScrollAnchor } from "./scroll-anchor";
import { DemoCard } from "./outcome";
import { SectionTag } from "./section-tag";
import { StagesBlock } from "./stages-block";
import { VoiceErrorLine, useVoiceBusy, useVoiceField } from "./voice";

type View = {
  draft: Draft;
  missing: ReadonlySet<string>;
  answered: boolean;
  sending: boolean;
  pick: (question: DecisionQuestion, optionId: string) => void;
  own: (question: DecisionQuestion, text: string) => void;
  change: (update: (draft: Draft) => Draft) => void;
  /** Правка выбора по этапам; касается не критерия, а этапов. */
  stageChange: (update: (draft: Draft) => Draft) => void;
  /** Строка первой части, чей выбор раскрыт под кнопками. */
  expanded: string | null;
  /** `anchor` — нажатая кнопка: раскрытие не сдвигает её на экране. */
  expand: (rowId: string | null, anchor?: Element | null) => void;
  /** Бриф, по которому считается прогноз бюджета. */
  brief: DecisionBrief;
  /** Прогноз, который владелец видел при отправке; у живого брифа и старых ответов его нет. */
  snapshot?: AnswerRecord["forecast"];
};

/** Прогноз ячейки и разбивки: снимок отвеченного брифа или пересчёт по черновику. */
const viewForecast = (view: View, locale: Locale) => view.snapshot ?? forecast(view.brief, toAnswer(view.brief, view.draft), locale);

/** Несёт ли ответ метки выбора владельца; ответы, записанные до меток, красятся по расхождению с рекомендацией. */
const hasPicks = (draft: Draft): boolean => Object.values(draft.entries).some((e) => (e.picked ?? []).length > 0);

const blank = (text: string): boolean => text.trim() === "";

// ——— мелкие части ———

/** `hintAfter` — скрытая подпись после текста: имя кнопки начинается с самого варианта, как у «Да» и «Нет». */
function Starred({ on, hintAfter = false, children }: { on: boolean; hintAfter?: boolean; children: ReactNode }) {
  const t = useMessages();
  const hint = on && <span className="sr-only">{t.common.recommendationHint}</span>;
  return (
    <span className="break-words">
      {on && (
        <span aria-hidden="true" className="mr-1 text-primary">
          ✦
        </span>
      )}
      {!hintAfter && hint}
      {children}
      {hintAfter && hint}
    </span>
  );
}

/** Кнопка с `aria-pressed`, а в отвеченном брифе — неинтерактивный блок того же вида. */
function Pressable(props: { view: View; on: boolean; onPress: () => void; className: string; children: ReactNode }) {
  return props.view.answered ? (
    <div className={props.className}>{props.children}</div>
  ) : (
    <button
      type="button"
      aria-pressed={props.on}
      disabled={props.view.sending}
      onClick={props.onPress}
      className={cn(props.className, !props.on && "hover:bg-state-hover", "disabled:cursor-default")}
    >
      {props.children}
    </button>
  );
}

/**
 * Поле своего ответа растёт по тексту; в отвеченном брифе — введённый текст или подсказка.
 * С `voiceId` справа микрофон, а на время записи поле уступает место полосе.
 */
function OwnField(props: { view: View; value: string; label: string; onChange: (text: string) => void; className: string; voiceId?: string; onEnter?: () => void }) {
  const voice = useVoiceField({ id: props.view.answered ? null : (props.voiceId ?? null), label: props.label, value: props.value, disabled: props.view.sending, onChange: props.onChange });
  const paste = usePasteImages({ value: props.value, onText: props.onChange });
  if (props.view.answered)
    return (
      <span className={cn(props.className, "inline-flex items-center", blank(props.value) && "text-muted-foreground/60")}>
        {blank(props.value) ? props.label : props.value}
      </span>
    );
  if (voice.phase !== null) return <div className="-ml-1.5 flex min-w-0 flex-1 items-center self-stretch">{voice.strip}</div>;
  return (
    <>
      <textarea
        ref={voice.ref}
        aria-label={props.label}
        placeholder={props.label}
        rows={1}
        value={props.value}
        disabled={props.view.sending}
        onChange={voice.onChange}
        onPaste={paste}
        onKeyDown={(event) => {
          if (props.onEnter === undefined || event.key !== "Enter" || event.shiftKey || blank(props.value)) return;
          event.preventDefault();
          props.onEnter();
        }}
        className={cn(props.className, "resize-none outline-none [field-sizing:content] placeholder:text-muted-foreground")}
      />
      {voice.mic !== null && <span className="flex shrink-0 self-start py-1.5">{voice.mic}</span>}
    </>
  );
}

function Missing({ view, id }: { view: View; id: string }) {
  const t = useMessages();
  return view.missing.has(id) ? <span className="block text-xs text-destructive">{t.common.needAnswer}</span> : null;
}

// ——— первая часть ———

const sameIds = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((id) => b.includes(id));

/** Контрастна ли ячейка строки: выбрал владелец; в ответе без меток — выбранное расходится с рекомендацией. */
const rowBright = (view: View, question: DecisionQuestion): boolean =>
  view.answered && !hasPicks(view.draft)
    ? !sameIds(view.draft.entries[question.id]?.optionIds ?? [], question.options.filter((o) => o.recommended).map((o) => o.id))
    : isPicked(view.draft, question.id);

function ArtifactCell(props: { artifact: Artifact; row: DecisionQuestion | undefined; view: View; openFile: OpenFile }) {
  const { artifact, row, view } = props;
  const locale = useLocale();
  const t = useMessages();
  // В брифе, записанном до отзыва утверждений, утверждённого нет в строке: он отмечен и не переключается.
  const toggle = row !== undefined && row.options.some((o) => o.id === artifact.id) ? row : undefined;
  const on = toggle === undefined ? artifact.state === "approved" : (view.draft.entries[toggle.id]?.optionIds.includes(artifact.id) ?? false);
  const recommendedTick = toggle?.options.find((o) => o.id === artifact.id)?.recommended ?? artifact.state === "approved";
  const bright = toggle === undefined ? false : view.answered && !hasPicks(view.draft) ? on !== recommendedTick : isPicked(view.draft, toggle.id, artifact.id);
  const verb = artifactVerb(artifact, locale);
  const required = requiredOf(view.brief).some((a) => a.id === artifact.id);
  return (
    <div data-artifact={artifact.id} data-checked={on} className={cn(buttonCard, "relative", toggle !== undefined && !view.answered && !on && "hover:bg-state-hover")}>
      {toggle !== undefined && !view.answered && (
        <button
          type="button"
          aria-pressed={on}
          aria-label={`${artifact.name}: ${verb.toLowerCase()}${required ? t.brief.requiredSuffix : ""}`}
          title={required ? t.brief.requiredTitle : undefined}
          disabled={view.sending}
          onClick={() => view.pick(toggle, artifact.id)}
          className="absolute inset-0 disabled:cursor-default"
        />
      )}
      <CardText label={artifact.name} meta={artifact.state === "approved" ? null : <AddMeta add={artifact.add} />} bright={bright}>
        {artifact.link === undefined ? verb : <DocumentName link={artifact.link} stale={artifact.state === "stale"} openFile={props.openFile} />}
      </CardText>
      <span className="pointer-events-none relative">
        <CheckSquare on={on} required={required} />
      </span>
    </div>
  );
}

/** Раскрытие кнопки бюджета: не строка ответа, а прогноз и своя цена. */
const BUDGET_PANEL = "budget";

/** Кнопка бюджета раскрывает разбивку и в отвеченном брифе: там она показывает снимок на момент отправки. */
function BudgetButton({ view }: { view: View }) {
  const locale = useLocale();
  const t = useMessages();
  const f = viewForecast(view, locale);
  const own = ownBudgetText(view.draft.budget, locale);
  const planned = plannedMinutes(f);
  const open = view.expanded === BUDGET_PANEL;
  const value = own ?? `${money(f.target)} · ${t.budget.upTo} ${money(f.max)}`;
  return (
    <button
      type="button"
      aria-expanded={open}
      disabled={view.sending}
      onClick={(e) => view.expand(open ? null : BUDGET_PANEL, e.currentTarget)}
      className={cn(buttonCard, open ? "bg-state-active" : "hover:bg-state-hover", "disabled:cursor-default")}
    >
      <CardText label={t.brief.budget} meta={planned === null ? null : minutesText(planned, locale)} bright={own !== null}>
        {value}
      </CardText>
      <Icon name="ChevronDown" aria-hidden="true" className={cn("size-3.5 shrink-0 text-muted-foreground", open && "rotate-180")} />
    </button>
  );
}

/** Деньги строки разбивки со знаком; неизвестные — прочерк. */
const signedMoney = (n: number | null): string => (n === null ? "—" : `${n < 0 ? "–" : "+"}${money(Math.abs(n))}`);

/** Время строки разбивки: потраченное на планирование — без знака, добавка — со знаком; неизвестное — пусто. */
const lineMinutes = (minutes: number | null, spent: boolean, locale: Locale): string =>
  minutes === null ? "" : spent ? minutesText(minutes, locale) : `${minutes < 0 ? "–" : "+"}${minutesText(Math.abs(minutes), locale)}`;

function BudgetPanel({ view }: { view: View }) {
  const locale = useLocale();
  const t = useMessages();
  const f = viewForecast(view, locale);
  const planned = plannedMinutes(f);
  const num = "px-3 py-1.5 text-right font-mono text-[11.5px]";
  const input = "h-7 w-full rounded-md bg-card px-2 text-right font-mono text-[11.5px] outline-none placeholder:text-muted-foreground";
  const head = "px-3 py-1 text-right font-normal";
  return (
    <div role="group" aria-label={t.brief.forecast} className="flex flex-col bg-surface-recessed-solid py-1">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="text-[11px] text-muted-foreground">
            <th className="px-3 py-1 text-left font-normal">
              <span className="sr-only">{t.brief.line}</span>
            </th>
            <th className={head}>{t.brief.time}</th>
            <th className={head}>{t.brief.risk}</th>
            <th className={head}>{t.brief.target}</th>
            <th className={head}>{t.brief.max}</th>
          </tr>
        </thead>
        <tbody>
          {f.lines.map((l, i) => {
            const spent = i < spentLines(f);
            return (
              <tr key={`${l.label}-${i}`} className="border-t border-border/40">
                <td className="px-3 py-1.5">
                  {l.label} <span className="text-muted-foreground">· {spent ? t.brief.spent : l.note}</span>
                </td>
                <td className={num}>{lineMinutes(l.minutes, spent, locale)}</td>
                <td className={num}>
                  <RiskText risk={l.risk} />
                </td>
                <td className={num}>{signedMoney(l.target)}</td>
                <td className={num}>{signedMoney(l.max)}</td>
              </tr>
            );
          })}
          <tr className="border-t border-border font-semibold">
            <td className="px-3 py-1.5">{t.brief.total}</td>
            <td className={num}>{planned === null ? "" : minutesText(planned, locale)}</td>
            <td className={num}>
              <RiskText risk={f.risk} />
            </td>
            <td className={num}>{money(f.target)}</td>
            <td className={num}>{money(f.max)}</td>
          </tr>
          {!view.answered && (
          <tr className="text-muted-foreground">
            <td className="px-3 py-1.5">{t.brief.ownPrice}</td>
            <td />
            <td />
            <td className="w-24 px-3 py-1">
              <input aria-label={t.brief.ownTarget} placeholder="$" value={view.draft.budget.target} disabled={view.sending} onChange={(e) => view.change((d) => setOwnBudget(d, "target", e.target.value))} className={input} />
            </td>
            <td className="w-24 px-3 py-1">
              <input aria-label={t.brief.ownMax} placeholder="$" value={view.draft.budget.max} disabled={view.sending} onChange={(e) => view.change((d) => setOwnBudget(d, "max", e.target.value))} className={input} />
            </td>
          </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Кнопка строки первой части: подпись и выбранное; нажатие раскрывает варианты строкой под кнопками. */
function ChoiceButton({ question, view }: { question: DecisionQuestion; view: View }) {
  const chosen = question.options.find((o) => view.draft.entries[question.id]?.optionIds.includes(o.id));
  const open = view.expanded === question.id;
  const value = chosen?.action ?? "—";
  const bright = rowBright(view, question);
  return view.answered ? (
    <div className={buttonCard}>
      <CardText label={question.question} bright={bright}>
        {value}
      </CardText>
    </div>
  ) : (
    <button
      type="button"
      aria-expanded={open}
      disabled={view.sending}
      onClick={(e) => view.expand(open ? null : question.id, e.currentTarget)}
      className={cn(buttonCard, open ? "bg-state-active" : "hover:bg-state-hover", "disabled:cursor-default")}
    >
      <CardText label={question.question} bright={bright}>
        {value}
      </CardText>
      <Icon name="ChevronDown" aria-hidden="true" className={cn("size-3.5 shrink-0 text-muted-foreground", open && "rotate-180")} />
    </button>
  );
}

function ChoicePanel({ question, view }: { question: DecisionQuestion; view: View }) {
  const t = useMessages();
  const executorIds = view.draft.entries[SETUP_ROW.executor]?.optionIds;
  const blocked = (optionId: string) => REVIEW_ROWS.includes(question.id) && !checkerAllowed(executorIds, optionId);
  const chosen = view.draft.entries[question.id]?.optionIds ?? [];
  return (
    <div role="group" aria-label={question.question} className="flex flex-col gap-px">
      {question.options.map((option) => {
        const on = chosen.includes(option.id);
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={on}
            disabled={view.sending || blocked(option.id)}
            onClick={() => {
              view.pick(question, option.id);
              view.expand(null);
            }}
            className={cn(
              "flex min-h-9 w-full flex-col items-start gap-0.5 bg-surface-recessed-solid px-3 py-2 text-left text-[13px]",
              on ? "bg-state-active font-medium" : "hover:bg-state-hover",
              "disabled:cursor-default disabled:opacity-50 disabled:hover:bg-surface-recessed-solid",
            )}
          >
            <Starred on={option.recommended}>{option.action}</Starred>
            {blocked(option.id) ? <span className="text-[11px] text-muted-foreground">{t.brief.whenWorkflow}</span> : <AddMeta add={option.add} className="whitespace-normal" />}
          </button>
        );
      })}
    </div>
  );
}

function ScaleRow({ question, view }: { question: DecisionQuestion; view: View }) {
  const t = useMessages();
  const entry = view.draft.entries[question.id];
  const own = entry?.own ?? "";
  const segment = "flex h-9 min-w-0 flex-1 items-center justify-center bg-surface-recessed-solid px-2 text-center text-xs text-muted-foreground";
  return (
    <div role="group" aria-label={question.question} className="grid grid-cols-1 items-center gap-x-2 gap-y-1 @[34rem]:grid-cols-4">
      <div className="min-w-0 break-words text-[13px]">
        {question.question}
        <Missing view={view} id={question.id} />
      </div>
      <div className="flex min-w-0 gap-px overflow-hidden rounded-lg @[34rem]:col-span-3">
        {question.options.map((option) => {
          const on = entry?.optionIds.includes(option.id) ?? false;
          return (
            <Pressable
              key={option.id}
              view={view}
              on={on}
              onPress={() => view.pick(question, option.id)}
              className={cn(segment, on && "bg-state-active font-medium text-foreground")}
            >
              <Starred on={option.recommended}>{option.action}</Starred>
            </Pressable>
          );
        })}
        {question.allowOwn && (
          <OwnField
            view={view}
            value={own}
            label={t.brief.ownPrice}
            onChange={(text) => view.own(question, text)}
            className={cn(segment, "h-auto min-h-9 whitespace-pre-wrap break-words py-2.5 leading-4 text-foreground", !blank(own) && "bg-state-active font-medium")}
          />
        )}
      </div>
    </div>
  );
}

/** Ряды целевого и максимального бюджета брифов, записанных до добавок `add`. */
function LegacyScales({ brief, view }: { brief: DecisionBrief; view: View }) {
  const locale = useLocale();
  const rows = new Map(rowsOf(brief, locale).map((row) => [row.id, row]));
  const scales = [SETUP_ROW.budgetTarget, SETUP_ROW.budgetMax].flatMap((id) => rows.get(id) ?? []);
  return scales.length === 0 ? null : (
    <div className="flex flex-col gap-2">
      {scales.map((question) => (
        <ScaleRow key={question.id} question={question} view={view} />
      ))}
    </div>
  );
}

/**
 * Один блок стык в стык: артефакты, кнопки первой части, раскрытый выбор и низ формы.
 * Что осталось незакрытым — одной строкой под блоком, чтобы подписи не рвали шов.
 */
function AnswerBlock({ brief, view, openFile, footer }: { brief: DecisionBrief; view: View; openFile: OpenFile; footer?: ReactNode }) {
  const locale = useLocale();
  const t = useMessages();
  const setup = brief.setup ?? {};
  const withBudget = hasForecast(brief);
  if (brief.setup === undefined && !withBudget && footer === undefined) return null;
  const stagesView = { ...view, change: view.stageChange };
  const rows = new Map(rowsOf(brief, locale).map((row) => [row.id, row]));
  const artifacts = rows.get(SETUP_ROW.artifacts);
  const buttons = [SETUP_ROW.executor, SETUP_ROW.checker, SETUP_ROW.testing].flatMap((id) => rows.get(id) ?? []);
  const expanded = buttons.find((q) => q.id === view.expanded);
  const ticked = view.draft.entries[SETUP_ROW.artifacts]?.optionIds ?? [];
  const mustTick = requiredOf(brief).filter((a) => !ticked.includes(a.id));
  const unanswered = buttons.filter((q) => view.missing.has(q.id)).map((q) => q.question);
  const hints = [
    unanswered.length > 0 ? t.brief.hintNeedAnswer(unanswered.join(", ")) : null,
    !view.answered && mustTick.length > 0 ? t.brief.hintRequired(mustTick.map((a) => a.name).join(", ")) : null,
  ].flatMap((hint) => (hint === null ? [] : [hint]));
  const staged = stageItems(brief).length > 0;
  const grid = "grid grid-cols-2 gap-px @[34rem]:grid-cols-4";
  // Кнопок с бюджетом может быть пять — тогда ряд делится на пять, чтобы не рвать шов.
  const buttonGrid = buttons.length + (withBudget ? 1 : 0) > 4 ? "grid grid-cols-2 gap-px @[34rem]:grid-cols-5" : grid;
  return (
    <div className="flex flex-col gap-1">
      <div role="group" aria-label={t.brief.answerGroup} className="flex flex-col gap-px overflow-hidden rounded-lg">
        {setup.artifacts !== undefined && (
          <div role="group" aria-label={t.brief.artifacts} className={grid}>
            {setup.artifacts.map((artifact) => (
              <ArtifactCell key={artifact.id} artifact={artifact} row={artifacts} view={view} openFile={openFile} />
            ))}
          </div>
        )}
        {staged && (
          <StagesBlock
            view={stagesView}
            openFile={openFile}
            budget={withBudget ? { key: BUDGET_PANEL, cell: <BudgetButton view={view} />, panel: <BudgetPanel view={view} /> } : null}
          />
        )}
        {(buttons.length > 0 || (withBudget && !staged)) && (
          <div className={buttonGrid}>
            {buttons.map((question) => (
              <ChoiceButton key={question.id} question={question} view={view} />
            ))}
            {withBudget && !staged && <BudgetButton view={view} />}
          </div>
        )}
        {expanded !== undefined && !view.answered && <ChoicePanel question={expanded} view={view} />}
        {withBudget && !staged && view.expanded === BUDGET_PANEL && <BudgetPanel view={view} />}
        {footer}
      </div>
      {hints.length > 0 && (
        <div className="flex flex-wrap gap-x-3 text-xs text-destructive">
          {hints.map((hint) => (
            <span key={hint}>{hint}</span>
          ))}
        </div>
      )}
      {footer !== undefined && <VoiceErrorLine scope="note" />}
    </div>
  );
}

// ——— «Готово, когда» ———

const itemText = "min-w-0 flex-1 whitespace-pre-wrap break-words py-2 text-[13px] leading-snug";
const itemButton = "flex h-7 shrink-0 items-center justify-center rounded-md px-1.5 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground disabled:cursor-default";

/**
 * Строка пункта: номер, текст и кнопки по центру по вертикали. Иконка 14px в кнопке 28px оставляет по 7px поля:
 * между иконками микрофона и креста 7 + 4 (gap-1) + 7, от иконки креста до края 7 + 11 (отступ строки) — поровну.
 */
function ItemRow({ mark, children }: { mark: ReactNode; children: ReactNode }) {
  return (
    <div data-item-row className="flex min-h-9 w-full items-center gap-3 bg-surface-recessed-solid pl-3 pr-[11px]">
      <span className="flex w-3.5 shrink-0 justify-center text-xs tabular-nums text-muted-foreground">{mark}</span>
      {children}
    </div>
  );
}

/** Микрофон и крест одной группой: зазор между ними равен зазору креста до края строки. */
function ItemActions({ children }: { children: ReactNode }) {
  return <span className="flex shrink-0 items-center gap-1">{children}</span>;
}

type FieldVoice = Pick<ReturnType<typeof useVoiceField>, "ref" | "onChange">;

/** Текст пункта; правка идёт через голосовой ввод строки, чтобы ошибка записи снималась при наборе. */
function ItemField(props: { view: View; label: string; value: string; className?: string; voice: FieldVoice; onText: (text: string) => void; onBlur?: () => void }) {
  const paste = usePasteImages({ value: props.value, onText: props.onText });
  return (
    <textarea
      ref={props.voice.ref}
      aria-label={props.label}
      placeholder={props.label}
      rows={1}
      value={props.value}
      disabled={props.view.sending}
      onChange={props.voice.onChange}
      onPaste={paste}
      onBlur={props.onBlur}
      className={cn(itemText, "resize-none bg-transparent outline-none [field-sizing:content] placeholder:text-muted-foreground", props.className)}
    />
  );
}

/**
 * «Было» → «стало» пункта-изменения: колонки не уже 240px, текст размером пункта.
 * Заголовков нет — что было, а что стало, говорит стрелка; в узком брифе колонки встают друг под друга.
 */
function Delta({ before, after }: { before: string; after: ReactNode }) {
  return (
    <span className="@container block w-full pb-2">
      <span className="grid grid-cols-1 items-start gap-x-2 gap-y-1 @[31.5rem]:grid-cols-[minmax(240px,1fr)_auto_minmax(240px,1fr)]">
        <span className="min-w-0 whitespace-pre-wrap break-words text-[13px] leading-snug text-muted-foreground">{before}</span>
        <span data-testid="delta-arrow" aria-hidden="true" className="flex h-[18px] items-center text-muted-foreground">
          <Icon name="ArrowRight" className="size-3.5 rotate-90 @[31.5rem]:rotate-0" />
        </span>
        <span className="min-w-0">{after}</span>
      </span>
    </span>
  );
}

/** `byOption` — пункт снят выбранным вариантом: вернуть его можно только сменой выбора. */
function CriterionRow({ item, index, view, byOption }: { item: Criterion; index: number; view: View; byOption: boolean }) {
  const t = useMessages();
  const n = index + 1;
  const original = criterionEditable(item);
  const change = changeOf(item);
  const title = criterionTitle(item);
  const add = typeof item === "string" ? undefined : item.add;
  const removed = byOption || view.draft.criteria.removed.includes(index);
  const text = view.draft.criteria.edited[index] ?? original;
  const edited = text !== original && text.trim() !== "";
  const toggle = () => view.change((d) => toggleCriterion(d, index));
  const voice = useVoiceField({
    id: view.answered || removed ? null : `criteria:item:${index}`,
    label: t.brief.item(n),
    value: text,
    disabled: view.sending,
    onChange: (t) => view.change((d) => editCriterion(d, index, t)),
    // Запись кончилась без текста, а пункт пуст: то же правило, что у ухода фокуса.
    onIdle: () => text.trim() === "" && view.change((d) => editCriterion(d, index, original)),
  });
  if (view.answered || removed)
    return (
      <ItemRow mark={String(n)}>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex flex-wrap items-baseline gap-x-3">
            <span className={cn(itemText, removed && "text-muted-foreground line-through")}>{removed || change !== undefined ? title : text}</span>
            {!removed && <AddMeta add={add} />}
          </span>
          {change !== undefined && !removed && <Delta before={change.before} after={<span className="whitespace-pre-wrap break-words text-[13px] leading-snug">{text}</span>} />}
        </span>
        {view.answered && edited && !removed && <span className="shrink-0 text-xs text-muted-foreground">{t.brief.rewritten}</span>}
        {!view.answered && !byOption && (
          <button type="button" aria-label={t.brief.restoreItem(n)} disabled={view.sending} onClick={toggle} className={itemButton}>
            {t.brief.restore}
          </button>
        )}
      </ItemRow>
    );
  const field = (label: string, className?: string) => (
    <ItemField
      view={view}
      label={label}
      value={text}
      className={className}
      voice={voice}
      onText={(t) => view.change((d) => editCriterion(d, index, t))}
      // Пустой пункт в ответ не уходит: чтобы владелец не видел пустоту, которой агент не получит, текст возвращается.
      onBlur={() => text.trim() === "" && view.change((d) => editCriterion(d, index, original))}
    />
  );
  return (
    <ItemRow mark={String(n)}>
      {voice.phase !== null ? (
        <div className="-ml-1.5 flex min-w-0 flex-1 items-center self-stretch">{voice.strip}</div>
      ) : (
        <>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex flex-wrap items-baseline gap-x-3">
            {change === undefined ? field(t.brief.item(n)) : <span className={itemText}>{title}</span>}
            <AddMeta add={add} />
          </span>
          {change !== undefined && <Delta before={change.before} after={field(t.brief.itemAfter(n), "w-full py-0")} />}
        </span>
        <ItemActions>
          {voice.mic}
          <button type="button" aria-label={t.brief.itemNotNeeded(n)} title={t.brief.itemNotNeededTitle} disabled={view.sending} onClick={toggle} className={cn(itemButton, "size-7 px-0")}>
            <Icon name="X" className="size-3.5" />
          </button>
        </ItemActions>
        </>
      )}
    </ItemRow>
  );
}

/** Добавленный владельцем пункт или хвостовое поле «Дополнить». */
function AddedRow({ view, index, text, removable }: { view: View; index: number; text: string; removable: boolean }) {
  const t = useMessages();
  const label = removable ? t.brief.addedItem(index + 1) : t.brief.addItem;
  const busy = useVoiceBusy();
  return (
    <AddRow label={label} value={text} disabled={view.sending} voiceId={`criteria:added:${index}`} onText={(next) => view.change((d) => setAddedCriterion(d, index, next))}>
      {removable && (
        <button type="button" aria-label={t.brief.removeAddedItem(index + 1)} disabled={view.sending || busy} onClick={() => view.change((d) => removeAddedCriterion(d, index))} className={cn(itemButton, "size-7 px-0")}>
          <Icon name="X" className="size-3.5" />
        </button>
      )}
    </AddRow>
  );
}

function CriteriaSection({ brief, view }: { brief: DecisionBrief; view: View }) {
  const t = useMessages();
  const answer = toAnswer(brief, view.draft);
  const fromOptions = optionCriteria(brief, answer);
  const items = brief.setup?.criteria ?? (fromOptions.length === 0 ? undefined : []);
  if (items === undefined) return null;
  const { added } = view.draft.criteria;
  const byOption = optionRemoved(brief, answer);
  const removed = removedCriteria(brief, answer);
  const kept = items.length - removed.filter((i) => i < items.length).length;
  // В брифе с этапами добавка пункта — доля внутри этапов: сумма долей у заголовка читалась бы добавкой к бюджету.
  const summary = brief.setup?.stages === undefined ? criteriaSum(brief, removed) : null;
  // Поле «Дополнить» — хвост списка добавленных: ключ совпадает с тем, под которым пункт появится, и фокус не теряется.
  // Без пунктов брифа ответ не несёт правок критерия, поэтому и дописать пункт негде.
  const ownItems = brief.setup?.criteria !== undefined;
  const tail = view.answered || !ownItems ? [] : [""];
  return (
    <div role="group" aria-label={t.brief.doneWhen} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-2">
        <SectionTag kind="criteria" extra={items.length > 0 ? t.brief.kept(kept, items.length) : undefined} />
        <AddMeta add={summary} className="ml-auto font-normal" />
      </div>
      <Missing view={view} id={SETUP_ROW.criteria} />
      <div className="flex flex-col gap-px overflow-hidden rounded-lg">
        {items.map((item, i) => (
          <CriterionRow key={`item-${i}`} item={item} index={i} view={view} byOption={byOption.includes(i)} />
        ))}
        {fromOptions.map((c, i) => (
          <ItemRow key={`option-${c.questionId}-${c.optionId}-${i}`} mark="↳">
            <span className={itemText}>{c.text}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{c.action}</span>
          </ItemRow>
        ))}
        {[...(ownItems ? added : []), ...tail].map((text, i) =>
          view.answered ? (
            <ItemRow key={`added-${i}`} mark="+">
              <span className={itemText}>{text}</span>
            </ItemRow>
          ) : (
            <AddedRow key={`added-${i}`} view={view} index={i} text={text} removable={i < added.length} />
          ),
        )}
      </div>
      <VoiceErrorLine scope="criteria" />
    </div>
  );
}

// ——— вторая часть ———

/** Цена варианта — только в брифе, где решается работа; после запуска её не показывают, даже если агент прислал добавку. */
function OptionMeta({ option, priced }: { option: DecisionOption; priced: boolean }) {
  const t = useMessages();
  if (!priced) return null;
  if (option.add !== undefined) return <AddMeta add={option.add} />;
  if (option.cost === undefined && option.risk === undefined) return null;
  return (
    <span className="flex min-w-0 flex-wrap gap-x-3 break-words text-[11px] text-muted-foreground">
      {option.cost !== undefined && (
        <span>
          {t.brief.price} <span className="font-mono">{option.cost}</span>
        </span>
      )}
      {option.risk !== undefined && (
        <span>
          {t.brief.riskLabel} <span className="font-mono">{option.risk}</span>
        </span>
      )}
    </span>
  );
}

function OptionCards({ question, view }: { question: DecisionQuestion; view: View }) {
  const t = useMessages();
  const entry = view.draft.entries[question.id];
  const chosen = entry?.optionIds ?? [];
  const own = entry?.own ?? "";
  const multi = question.kind === "pick";
  const anyChosen = chosen.length > 0 || !blank(own);
  return (
    <div className="mt-2 flex flex-col gap-px overflow-hidden rounded-lg">
      {question.options.map((option) => {
        const on = chosen.includes(option.id);
        return (
          <Pressable
            key={option.id}
            view={view}
            on={on}
            onPress={() => view.pick(question, option.id)}
            className={cn("flex w-full gap-3 bg-surface-recessed-solid px-3 py-2.5 text-left", on && "bg-state-active", anyChosen && !on && "opacity-60")}
          >
            {multi && (
              <span className="pt-0.5">
                <CheckSquare on={on} />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-start gap-x-3 gap-y-0.5">
                <span className="min-w-[min(12rem,100%)] flex-1 text-[13px] font-medium leading-snug">
                  <Starred on={option.recommended}>{option.action}</Starred>
                </span>
                <OptionMeta option={option} priced={view.brief.launched !== true} />
              </span>
              {option.description !== undefined && (
                <span className="mt-1 block break-words text-xs leading-relaxed text-muted-foreground">{option.description}</span>
              )}
              {option.risks !== undefined && (
                <span className="mt-1 block break-words text-xs leading-relaxed text-muted-foreground">{t.brief.risks} {option.risks}</span>
              )}
            </span>
          </Pressable>
        );
      })}
      {view.answered ? (
        !blank(own) && (
          <div className="flex min-h-9 w-full items-center gap-3 bg-state-active pl-3 pr-3">
            <span className="w-3.5 shrink-0" />
            <span className={addRowText}>{own}</span>
          </div>
        )
      ) : (
        <AddRow label={t.common.ownAnswer} value={own} active={!blank(own)} disabled={view.sending} voiceId={`own:${question.id}`} onText={(text) => view.own(question, text)} />
      )}
    </div>
  );
}

function ConfirmRow({ question, view, ownLabel, onEnter }: { question: DecisionQuestion; view: View; ownLabel?: string; onEnter?: () => void }) {
  const t = useMessages();
  const entry = view.draft.entries[question.id];
  const own = entry?.own ?? "";
  return (
    <div className="mt-2 flex items-stretch gap-px overflow-hidden rounded-lg">
      {question.options.map((option) => {
        const on = entry?.optionIds.includes(option.id) ?? false;
        return (
          <Pressable
            key={option.id}
            view={view}
            on={on}
            onPress={() => view.pick(question, option.id)}
            className={cn(
              "flex min-h-9 shrink-0 items-center bg-surface-recessed-solid px-4 text-xs",
              on && "bg-state-active font-medium",
              !blank(own) && "text-muted-foreground",
            )}
          >
            <Starred on={option.recommended} hintAfter>
              {option.action}
            </Starred>
          </Pressable>
        );
      })}
      {view.answered ? (
        <div className={cn("flex min-h-9 min-w-0 flex-1 items-center bg-surface-recessed-solid px-3", !blank(own) && "bg-state-active")}>
          <span className={cn(addRowText, blank(own) && "text-muted-foreground/60")}>{blank(own) ? (ownLabel ?? t.common.ownAnswer) : own}</span>
        </div>
      ) : (
        <AddRow
          label={ownLabel ?? t.common.ownAnswer}
          value={own}
          active={!blank(own)}
          disabled={view.sending}
          voiceId={`own:${question.id}`}
          onText={(text) => view.own(question, text)}
          onEnter={onEnter}
          className="min-w-0 flex-1"
        />
      )}
    </div>
  );
}

function QuestionsSection({ brief, view }: { brief: DecisionBrief; view: View }) {
  const hidden = hiddenIn(brief, view.draft);
  const visible = brief.questions.filter((q) => !hidden.has(q.id));
  if (visible.length === 0) return null;
  return (
    <div className="flex flex-col gap-4">
      <SectionTag kind="questions" className="-mb-2" />
      {visible.map((question, i) => (
        <div key={question.id} role="group" aria-label={question.question}>
          <div className="break-words text-[13px] font-medium leading-snug">{`${i + 1}. ${question.question}`}</div>
          {question.context !== undefined && (
            <div className="mt-0.5 break-words text-xs text-muted-foreground">{question.context}</div>
          )}
          <Missing view={view} id={question.id} />
          {question.kind === "confirm" ? <ConfirmRow question={question} view={view} /> : <OptionCards question={question} view={view} />}
          <VoiceErrorLine scope={`own:${question.id}`} className="mt-1" />
        </div>
      ))}
    </div>
  );
}

// ——— формы ———

/** Ячейка низа: место исполнения и строка состояния — текст переносится и прижат влево. */
const footerCell = "flex min-h-10 min-w-0 flex-1 basis-0 items-center break-words bg-surface-recessed-solid px-3.5 py-2 text-left text-xs leading-snug";

/** Иконка места: ветка — новый тред идёт по ветке этого треда, ветвление — по своей, отведённой от неё. */
const PLACE_ICON = { here: null, thread: "GitBranch", worktree: "Fork" } as const;

const THREAD_ICON = { here: "MessageSquare", thread: "MessageSquarePlus" } as const;

const TREE_ICON = { same: "FolderGit", new: "FolderPlus", local: "Laptop" } as const satisfies Record<RouteTree, string>;

const BRANCH_ICON = { current: "GitBranch", "from-current": "Fork", "from-origin-main": "Cloud", "from-main": "GitMerge", none: "CircleX" } as const satisfies Record<RouteBranch, string>;

/** Выбор места исполнения ячейкой ряда; нерешённые вопросы его не запирают — это не ответ, а адрес работы. */
function PlaceCell(props: { place: DispatchPlace; route: DispatchRoute; open: boolean; disabled: boolean; onToggle: () => void }) {
  const t = useMessages();
  const here = props.place === "here";
  const icon = PLACE_ICON[props.place];
  return (
    <button
      type="button"
      aria-label={t.common.dispatchLabel}
      aria-expanded={props.open}
      disabled={props.disabled}
      onClick={props.onToggle}
      className={cn(footerCell, "justify-between gap-2 hover:bg-state-hover", props.open && "bg-state-active")}
    >
      <span className="flex min-w-0 flex-col py-0.5 leading-tight">
        <span className="text-[11px] text-muted-foreground">{t.common.dispatchLabel}</span>
        <span className="flex min-w-0 items-center gap-1 text-[13px] font-medium">
          {icon !== null && <Icon name={icon} className="size-3.5 shrink-0 text-muted-foreground" />}
          <span className="truncate">
            {here ? t.common.dispatchHere : t.common.dispatchThread}
            {!here && <span className="font-normal text-muted-foreground"> · {t.common.routeTreeShort[props.route.tree]} · {t.common.routeBranchShort[props.route.branch]}</span>}
          </span>
        </span>
      </span>
      <Icon name="ChevronDown" className={cn("size-3.5 shrink-0 text-muted-foreground", props.open && "rotate-180")} />
    </button>
  );
}

/** Один из трёх списков места: пункт с иконкой, выбранный — с галочкой. */
function RouteGroup<Id extends string>(props: { label: string; items: ReadonlyArray<{ id: Id; name: string; icon: string; disabled: boolean }>; chosen: Id; onPick: (id: Id) => void; className?: string }) {
  return (
    <div role="group" aria-label={props.label} className={cn("flex min-w-0 flex-col gap-px", props.className)}>
      {props.items.map(({ id, name, icon, disabled }) => {
        const on = id === props.chosen;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => props.onPick(id)}
            className="flex min-h-9 items-center justify-between gap-2 bg-state-active px-3.5 py-2 text-left text-[13px] enabled:hover:bg-state-hover disabled:cursor-default disabled:text-muted-foreground/60"
          >
            <span className={cn("flex min-w-0 items-center gap-1.5", on && "font-semibold")}>
              <Icon name={icon} aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{name}</span>
            </span>
            {on && <Icon name="Check" aria-hidden="true" className="size-3.5 shrink-0" />}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Три списка места — строкой под рядом, как раскрытый выбор этапа: поповер над лентой уезжал бы при прокрутке.
 * В этом треде дерево и ветку не выбирают; ветки, невозможные в выбранном дереве, выключены.
 */
function PlaceLists(props: { place: DispatchPlace; route: DispatchRoute; onPlace: (place: DispatchPlace) => void; onRoute: (route: DispatchRoute) => void; gap?: string; joined?: boolean }) {
  const t = useMessages();
  const here = props.place === "here";
  const threads = OFFERED_PLACES.map((id) => ({ id, name: id === "here" ? t.common.dispatchInThread : t.common.dispatchInNewThread, icon: THREAD_ICON[id], disabled: false }));
  const trees = ROUTE_TREES.map((id) => ({ id, name: t.common.routeTree[id], icon: TREE_ICON[id], disabled: here }));
  const branches = ROUTE_BRANCHES.map((id) => ({ id, name: t.common.routeBranch[id], icon: BRANCH_ICON[id], disabled: here || !branchAllowed(props.route.tree, id) }));
  // Одним контейнером: подложка контейнера заполняет зазоры колонок и место под короткими, швы между пунктами — фоном колонки.
  const column = props.joined ? "self-start bg-background" : undefined;
  return (
    <div className={cn("grid grid-cols-1 @[34rem]:grid-cols-3", props.gap ?? "gap-px", props.joined && JOINED_LISTS)}>
      <RouteGroup label={t.common.dispatchThreadGroup} items={threads} chosen={props.place === "worktree" ? "thread" : props.place} onPick={props.onPlace} className={column} />
      <RouteGroup label={t.common.dispatchTreeGroup} items={trees} chosen={props.route.tree} onPick={(tree) => props.onRoute(withTree(props.route, tree))} className={column} />
      <RouteGroup label={t.common.dispatchBranchGroup} items={branches} chosen={props.route.branch} onPick={(branch) => props.onRoute(withBranch(props.route, branch))} className={column} />
    </div>
  );
}

/**
 * «Исполнять» у любой отправки: ячейка встаёт слева в ряд кнопок, раскрытые списки — строкой под рядом.
 * Место и маршрут берутся из черновика, а без выбора владельца — запомненные в проекте.
 */
export function useDispatchPicker(props: { draft: Draft; setDraft: (update: (draft: Draft) => Draft) => void; place: DispatchPlace; route: DispatchRoute; disabled: boolean; gap?: string; joined?: boolean }): { cell: ReactNode; lists: ReactNode } {
  const [open, setOpen] = useState(false);
  const place = placeIn(props.draft, props.place);
  const route = routeIn(props.draft, props.route);
  return {
    cell: <PlaceCell place={place} route={route} open={open} disabled={props.disabled} onToggle={() => setOpen((value) => !value)} />,
    lists: open ? <PlaceLists gap={props.gap} joined={props.joined} place={place} route={route} onPlace={(picked) => props.setDraft((d) => setPlace(d, picked))} onRoute={(picked) => props.setDraft((d) => setRoute(d, picked))} /> : null,
  };
}

/**
 * Низ формы внутри блока: строка «Дополнить», слева место исполнения, справа отправка.
 * Счётчик незакрытого — подпись внутри кнопки над «Отправить», а кнопка выключена, пока решено не всё.
 */
function BriefFooter(props: {
  brief: DecisionBrief;
  draft: Draft;
  setDraft: (update: (draft: Draft) => Draft) => void;
  sending: boolean;
  status: string | null;
  complete: boolean;
  place: DispatchPlace;
  route: DispatchRoute;
  onSubmit: () => void;
}) {
  const { sending } = props;
  const t = useMessages();
  const picker = useDispatchPicker({ draft: props.draft, setDraft: props.setDraft, place: props.place, route: props.route, disabled: sending });

  return (
    <>
      <AddRow label={t.common.noteLabel} placeholder={t.brief.addItem} value={props.draft.note} disabled={sending} voiceId="note" onText={(text) => props.setDraft((d) => setNote(d, text))} />
      <AttachmentThumbs className="bg-surface-recessed-solid px-3 py-2" />
      <div className="grid grid-cols-1 gap-px @[34rem]:grid-cols-2">
        <div className="flex min-w-0 gap-px">{picker.cell}</div>
        <Button
          type="button"
          aria-label={t.common.sendBrief}
          aria-description={props.status ?? undefined}
          disabled={!props.complete || sending}
          onClick={props.onSubmit}
          className="h-auto min-h-10 rounded-none px-3.5 py-2"
        >
          {/* Счётчик — подписью над «Отправить», как «Исполнять» над местом, только по центру. */}
          <span className="flex min-w-0 flex-col items-center py-0.5 leading-tight">
            {props.status !== null && <span className="text-[11px] font-normal opacity-70">{props.status}</span>}
            <span className="flex items-center gap-1.5 text-[13px] font-semibold">
              {sending && <Icon name="Spinner" className="size-3.5 animate-spin" />}
              {t.common.send}
            </span>
          </span>
        </Button>
      </div>
      {picker.lists}
    </>
  );
}

/** Раскрытые списки «Исполнять» одним скруглённым контейнером — под рядом отдельных кнопок. */
const JOINED_LISTS = "overflow-hidden rounded-lg bg-state-active";

/** Зазор ряда кнопок Демонстрации; раскрытые списки «Исполнять» под ним — с тем же зазором, чтобы колонки стояли под кнопками. */
const DEMO_GAP = "gap-2";

/** Ряд кнопок Демонстрации — колонки одной ширины не уже 10rem: у flex с `basis-0` отступы кнопок делали их шире «Исполнять». */
const DEMO_ROW = "grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]";

/**
 * Кнопки Демонстрации — отдельным рядом с отступом от карточки, чтобы не нажать случайно.
 * Пустой комментарий — одна «Продолжить» («Завершить» у финальной); написанный — «Учесть и продолжить» тихой кнопкой и «На доработку» главной.
 */
function DemoActions(props: { brief: DecisionBrief; draft: Draft; setDraft: (update: (draft: Draft) => Draft) => void; sending: boolean; failed: boolean; complete: boolean; place: DispatchPlace; route: DispatchRoute; onSubmit: (draft: Draft) => void }) {
  const t = useMessages();
  const picker = useDispatchPicker({ draft: props.draft, setDraft: props.setDraft, place: props.place, route: props.route, disabled: props.sending, gap: DEMO_GAP, joined: true });
  const commented = (props.draft.outcomeNote ?? "").trim() !== "";
  const send = (rework: boolean) => {
    const next = setOutcomeRework(props.draft, rework);
    props.setDraft(() => next);
    props.onSubmit(next);
  };
    const button = "h-auto min-h-10 min-w-0 rounded-lg px-4 text-[13px] font-semibold";
  // Вопросы того же брифа должны быть решены до исхода: неполный ответ иначе отбил бы только сервер.
  const blocked = props.sending || !props.complete;
  return (
    <div className="-mt-2 flex flex-col items-stretch gap-1.5">
      <div className={cn(DEMO_ROW, DEMO_GAP)}>
        <div data-demo-action className="flex min-w-0 overflow-hidden rounded-lg">{picker.cell}</div>
        {commented ? (
          <>
            <Button type="button" variant="ghost" disabled={blocked} onClick={() => send(false)} className={cn(button, "bg-surface-recessed-solid font-medium")}>
              {t.outcome.withComment}
            </Button>
            <Button type="button" disabled={blocked} onClick={() => send(true)} className={button}>
              {props.sending && <Icon name="Spinner" className="size-3.5 animate-spin" />}
              {t.outcome.rework}
            </Button>
          </>
        ) : (
          <Button type="button" disabled={blocked} onClick={() => props.onSubmit(props.draft)} className={button}>
            {props.sending && <Icon name="Spinner" className="size-3.5 animate-spin" />}
            {props.brief.outcome?.final === true ? t.outcome.finish : t.outcome.continue}
          </Button>
        )}
      </div>
      {picker.lists}
      {props.failed && <div className="text-right text-xs text-destructive">{t.common.sendFailed}</div>}
    </div>
  );
}

/** Бриф без рамки и шапки: вопросы, критерий, первая часть, низ; части подписаны бирками вида. */
function Plain(props: { label: string; busy?: boolean; onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void; children: ReactNode }) {
  return (
    <div role="group" aria-label={props.label} aria-busy={props.busy || undefined} onKeyDown={props.onKeyDown} className="@container my-3 flex w-full flex-col gap-5">
      {props.children}
    </div>
  );
}

function Heading({ brief, subtitle }: { brief: DecisionBrief; subtitle?: string }) {
  const second = subtitle ?? brief.intro;
  return (
    <div className="flex flex-col gap-0.5">
      <div className="break-words text-sm font-medium leading-snug">{brief.title}</div>
      {second !== undefined && <div className="break-words text-xs text-muted-foreground">{second}</div>}
    </div>
  );
}

function Body({ brief, view }: { brief: DecisionBrief; view: View }) {
  return (
    <>
      <QuestionsSection brief={brief} view={view} />
      <CriteriaSection brief={brief} view={view} />
      <LegacyScales brief={brief} view={view} />
    </>
  );
}

export function BriefCard({ brief, send, onResult, openFile, place = "here", route = DEFAULT_ROUTE }: FormProps & { openFile: OpenFile; place?: DispatchPlace; route?: DispatchRoute }) {
  const [draft, setDraft] = useStoredDraft(brief.id, () => initialDraft(brief));
  const [expanded, setExpanded] = useState<string | null>(null);
  const anchor = useScrollAnchor();
  const { sending, failed, missing, touch, submit } = useSubmit({ send, onResult });
  const t = useMessages();
  const { decided, total } = decidedCount(brief, draft);
  const complete = decided === total;
  const counter = complete ? null : t.common.filled(decided, total);
  const view: View = {
    draft,
    missing,
    answered: false,
    sending,
    pick: (question, optionId) => {
      touch(question.id);
      setDraft((d) => pickOption(d, question, optionId, brief));
    },
    own: (question, text) => {
      touch(question.id);
      setDraft((d) => setOwn(d, question, text));
    },
    change: (update) => {
      touch(SETUP_ROW.criteria);
      setDraft(update);
    },
    stageChange: setDraft,
    expanded,
    expand: (rowId, element) => {
      anchor(element);
      setExpanded(rowId);
    },
    brief,
  };
  const trySubmit = () => {
    // Место уходит в ответ всегда: запомненное, которого владелец не трогал, иначе осталось бы только на экране.
    if (complete && !sending) void submit(settleDispatch(draft, place, route));
  };

  return (
    <AttachmentsProvider briefId={brief.id}>
    <Plain
      label={brief.title}
      busy={sending}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          trySubmit();
        }
      }}
    >
      {brief.outcome !== undefined ? (
        <>
          <DemoCard brief={brief} openFile={openFile} view={{ draft, sending, change: setDraft }} />
          <Body brief={brief} view={view} />
          <DemoActions brief={brief} draft={draft} setDraft={setDraft} sending={sending} failed={failed} complete={complete} place={place} route={route} onSubmit={(next) => void submit(settleDispatch(next, place, route))} />
        </>
      ) : (
        <>
          <Body brief={brief} view={view} />
          {stageItems(brief).length > 0 && <SectionTag kind="select" className="-mb-3" />}
          <AnswerBlock
            brief={brief}
            view={view}
            openFile={openFile}
            footer={<BriefFooter brief={brief} draft={draft} setDraft={setDraft} sending={sending} status={failed ? t.common.sendFailed : counter} complete={complete} place={place} route={route} onSubmit={trySubmit} />}
          />
        </>
      )}
    </Plain>
    </AttachmentsProvider>
  );
}

const noop = () => {};

/** Строка состояния под брифом: значок, что это, и пояснение через точку. */
function StatusLine({ icon, title, aside }: { icon: "CircleCheck" | "MessageQuestion"; title: string; aside: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Icon name={icon} className="size-3.5" />
      <span>{title}</span>
      <span aria-hidden="true">·</span>
      <span>{aside}</span>
    </div>
  );
}

/**
 * Уточнение нового вида: вопрос и под ним одна строка стык в стык — варианты и
 * своё поле. Кнопки отправки нет: ответ уходит по нажатию варианта и по Enter
 * в поле, а мимо уточнения можно пройти — агент продолжит по своему пониманию.
 */
export function ClarifyCard({ brief, send, onResult }: FormProps) {
  const t = useMessages();
  const [draft, setDraft] = useStoredDraft(brief.id);
  const { sending, failed, submit } = useSubmit({ send, onResult });
  const view: View = {
    draft,
    missing: new Set(),
    answered: false,
    sending,
    pick: (question, optionId) => {
      const next = pickOption(draft, question, optionId, brief);
      setDraft(next);
      void submit(next);
    },
    own: (question, text) => setDraft((d) => setOwn(d, question, text)),
    change: noop,
    stageChange: noop,
    expanded: null,
    expand: noop,
    brief,
  };
  return (
    <AttachmentsProvider briefId={brief.id}>
    <Plain label={brief.title} busy={sending}>
      <SectionTag kind="clarify" className="-mb-3" />
      {brief.questions.map((question) => (
        <div key={question.id} role="group" aria-label={question.question}>
          <div className="break-words text-[13px] font-medium leading-snug">{question.question}</div>
          {question.context !== undefined && <div className="mt-0.5 break-words text-xs text-muted-foreground">{question.context}</div>}
          <ConfirmRow question={question} view={view} ownLabel={t.brief.orOwnWords} onEnter={() => void submit(draft)} />
          <VoiceErrorLine scope={`own:${question.id}`} className="mt-1" />
        </div>
      ))}
      <AttachmentThumbs />
      <StatusLine icon="MessageQuestion" title={t.brief.clarify} aside={failed ? t.brief.notSent : t.brief.optional} />
    </Plain>
    </AttachmentsProvider>
  );
}

export function AnsweredBriefCard({ brief, record, openFile }: { brief: DecisionBrief; record: AnswerRecord; openFile: OpenFile }) {
  const t = useMessages();
  const [expanded, setExpanded] = useState<string | null>(null);
  const anchor = useScrollAnchor();
  const expand = (rowId: string | null, element?: Element | null) => {
    anchor(element);
    setExpanded(rowId);
  };
  const view: View = { draft: fromAnswer(record.answer), missing: new Set(), answered: true, sending: false, pick: noop, own: noop, change: noop, stageChange: noop, expanded, expand, brief, snapshot: record.forecast };
  return (
    <Plain label={brief.title}>
      {brief.outcome !== undefined ? (
        <>
          <DemoCard brief={brief} openFile={openFile} />
          <Body brief={brief} view={view} />
          <div className="break-words text-xs text-muted-foreground">
            <b className="font-semibold text-foreground">{t.outcome.verdict(demoVerdict(record.answer) ?? "rework")}</b>
            {!blank(record.answer.outcome?.note ?? "") && ` — ${record.answer.outcome?.note ?? ""}`}
          </div>
        </>
      ) : (
        <>
          <Heading brief={brief} subtitle={t.common.deviations(deviations(brief, record.answer), deviationTotal(brief))} />
          <Body brief={brief} view={view} />
          <AnswerBlock brief={brief} view={view} openFile={openFile} />
        </>
      )}
      {!blank(record.answer.note ?? "") && (
        <div className="break-words text-xs text-muted-foreground">
          <b className="font-semibold text-foreground">{t.common.noteToBrief}</b> {record.answer.note}
        </div>
      )}
      {record.handoffThreadId !== undefined && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Icon name="Fork" className="size-3.5" />
          <span>{t.common.handedOff(record.handoffThreadId)}</span>
        </div>
      )}
      <StatusLine icon="CircleCheck" title={brief.kind === "clarify" ? t.common.clarifyAnswered : t.common.briefAnswered} aside={answeredAt(record.answeredAt, t.common.dateLocale)} />
    </Plain>
  );
}
