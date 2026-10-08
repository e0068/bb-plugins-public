// Баннер прогресса flow над композером треда: шапкой композера — номер идущего
// этапа и общее число, сегменты этапов со значком идущего поверх его сегмента и
// план времени и бюджета; тап раскрывает над шапкой список этапов. Опрос RPC раз
// в 5 секунд — прогресс пишут бриф, ответ, отметки агента и исполнитель
// автоматизаций. Этап, на котором идёт работа, приглушённо мерцает значком.
// Строка этапа — аккордеон: развёрнутая показывает все его результаты, у
// автоматизации — её шаги с тем, что каждый сделал, и повтором упавшего.
// Минуты и доллары — своими колонками: у пройденного этапа факт, у этапа
// впереди — едва заметный план, последней строкой — сколько потрачено всего.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useBbNavigate, useComposerView, useRpc } from "@get-bb/plugin-sdk/app";

import { contextPercent, contextSegments, contextTone, shortTokens } from "../core/context";
import { mutedBlinkAnimation, mutedBlinkKeyframes } from "../core/muted-blink";
import { PULL_SETTLE_MS, pullOffset, settlesClosed } from "../core/pull-to-collapse";
import { stepDetail, type FileRoots } from "../core/result-link";
import { stageLabel } from "../core/stages";
import { runCascade } from "../core/sub-stages";
import { ConfirmDialog } from "../components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../components/ui/dropdown-menu";
import { FlowMark } from "../components/ui/flow-mark";
import { Icon } from "../components/ui/icon";
import { cn } from "../lib/utils";
import type { ContextFillView, ProgressStage, ProgressView, automationRpcContract, flowChoiceRpcContract, progressRpcContract } from "../shared/contract";
import { reportStepAnswer } from "./automation-toasts";
import { ResultAnchor } from "./cells";
import { useFileRoots } from "./file-roots";
import { FlowChoice } from "./flow-choice";
import { LocaleProvider } from "./locale";
import { ProviderLogosProvider } from "./provider-logos-source";
import { ProviderMark } from "./provider-logos";
import { useMessages } from "./locale-context";
import { KIND_ICONS } from "./stage-icons";
import { stageIconName } from "../lib/stage-icon-names";
import { StageCheckbox } from "./stage-checkbox";
import { hasOwnIcon, StageGlyph } from "./stage-glyph";

/** Тон заливки занятого окна: те же семантические токены, что у остальных состояний баннера. */
const CONTEXT_TONES = { normal: "bg-primary", warn: "bg-warning", alert: "bg-destructive" } as const;

/** Процент ширины без хвоста плавающей точки: 0,5000000000000001 → «50%». */
const widthOf = (share: number): string => `${Number((share * 100).toFixed(2))}%`;

/**
 * Вторая полоса шапки: доля занятого окна контекста под полосой этапов,
 * разрезанная порогами владельца на отрезки. Числа и пороги приезжают готовыми
 * в ответе баннера — здесь только раскладка и тон. Тон один на всю заливку:
 * он говорит, в какой зоне тред сейчас, а отрезки — где начинается следующая.
 */
function ContextBar({ fill }: { fill: ContextFillView }) {
  const t = useMessages();
  // Ответ баннера сам несёт пару порогов — отдельного объекта не собираем.
  const tone = CONTEXT_TONES[contextTone(fill.usedTokens, fill)];
  return (
    <span
      data-context-bar
      title={t.progress.context(contextPercent(fill.share), shortTokens(fill.usedTokens), shortTokens(fill.windowTokens), shortTokens(fill.warnTokens), shortTokens(fill.alertTokens))}
      className="flex h-1 gap-0.5"
    >
      {contextSegments(fill.usedTokens, fill.windowTokens, fill).map((segment, index) => (
        <span key={index} data-context-segment style={{ flexGrow: segment.size }} className="flex basis-0 overflow-hidden rounded-sm bg-state-active">
          <i data-context-used aria-hidden="true" style={{ width: widthOf(segment.filled) }} className={cn("rounded-sm", tone)} />
        </span>
      ))}
    </span>
  );
}

const POLL_MS = 5000;

/** Кривая доводки списка после отпускания пальца — та же, что у шторок кита. */
const SETTLE_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";

const iconOf = (stage: ProgressStage): string => stageIconName({ kind: stage.kind, executor: stage.executor, automation: stage.automation !== undefined });

/** У этапа навыка, который ведёт сам агент или субагент, — логотип провайдера исполнителя. */
const byProvider = (stage: ProgressStage): boolean => stage.automation === undefined && stage.kind === "skill" && stage.executor !== "workflow";

/** Приглушённое мерцание элемента, на этапе которого идёт работа; кадры кладёт полоса. */
export const pulse = (live: boolean | undefined) => (live === true ? { "data-pulse": "", style: { animation: mutedBlinkAnimation } } : {});

/** Значок этапа: иконка, выбранная владельцем, а без неё — логотип исполнителя или иконка вида; мерцает, пока на этапе идёт работа. */
export function StageIcon({ stage, className }: { stage: ProgressStage; className?: string }) {
  return (
    <span data-stage-icon {...pulse(stage.live)} className={cn("flex items-center justify-center", stage.state === "fail" && "text-destructive")}>
      {hasOwnIcon(stage.icon) ? (
        <StageGlyph icon={stage.icon} fallback={iconOf(stage)} className={cn("size-3.5", className)} />
      ) : byProvider(stage) ? (
        <ProviderMark providerId={stage.provider} framed={stage.executor === "agent"} fallback={iconOf(stage)} className={cn("size-3.5", className)} />
      ) : (
        <Icon name={iconOf(stage)} aria-hidden="true" className={cn("size-3.5", className)} />
      )}
    </span>
  );
}

type StepView = NonNullable<ProgressStage["automation"]>["steps"][number];

/** Подпись шага: встроенный — по языку интерфейса, шаг Automations — как назван там. */
const useStepLabel = () => {
  const t = useMessages();
  return (step: StepView): string => (step.id in t.steps ? t.steps[step.id as keyof typeof t.steps] : step.label);
};

/** Подпись этапа Action в полосе: идёт нажатый шаг или этап ждёт владельца. */
const actionNote = (stage: ProgressStage, t: ReturnType<typeof useMessages>): string =>
  pendingStep(stage)?.step.state === "now" ? t.progress.actionBusy : t.progress.waiting;

/** Шаг этапа Action, который ждёт владельца: ждущий нажатия, идущий или упавший; пройденные и будущие ждать нечего. */
const pendingStep = (stage: ProgressStage): { step: StepView; index: number } | null => {
  const steps = stage.automation?.steps ?? [];
  const index = steps.findIndex((step) => step.state === "wait" || step.state === "now" || step.state === "fail");
  return stage.kind !== "action" || index === -1 ? null : { step: steps[index]!, index };
};

/**
 * Кнопка шага этапа Action: ждёт нажатия — имя шага, идёт — лоадер и выключена,
 * упал — «Повторить». Нажатие зовёт `runActionStep` и держит кнопку выключенной до ответа.
 */
function ActionButton({ stage, step, threadId, wide = false }: { stage: ProgressStage; step: StepView; threadId: string; wide?: boolean }) {
  const t = useMessages();
  const label = useStepLabel();
  const rpc = useRpc<typeof automationRpcContract>();
  const [sending, setSending] = useState(false);
  const busy = step.state === "now" || sending;
  return (
    <button
      type="button"
      data-action-step
      aria-label={step.state === "fail" ? t.progress.retryStep(label(step)) : busy ? t.progress.actionBusy : t.progress.actionRun(label(step))}
      disabled={busy}
      onClick={() => {
        setSending(true);
        void rpc.call("runActionStep", { threadId, stage: stage.id }).finally(() => setSending(false));
      }}
      className={cn(
        "inline-flex max-w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[11.5px] font-semibold",
        wide ? "h-7" : "h-6",
        step.state === "fail" ? "border border-border text-foreground hover:bg-state-hover" : "bg-foreground text-background hover:bg-foreground/90",
        busy && "cursor-default opacity-70",
      )}
    >
      {busy ? (
        <span data-action-spinner aria-hidden="true" className="size-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
      ) : (
        <Icon name={step.state === "fail" ? "Repeat" : KIND_ICONS.action} aria-hidden="true" className="size-3" />
      )}
      <span className="truncate">{step.state === "fail" ? t.progress.retry : busy ? t.progress.actionBusy : label(step)}</span>
    </button>
  );
}

/** Полоса под шапкой свёрнутой полосы: этап Action виден и закрытым баннером — иначе кнопку негде нажать. */
function ActionBar({ stage, threadId }: { stage: ProgressStage; threadId: string }) {
  const t = useMessages();
  const pending = pendingStep(stage);
  if (pending === null) return null;
  const total = stage.automation?.steps.length ?? 0;
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-1.5">
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate">{t.progress.actionWaiting(stage.name, pending.index + 1, total)}</span>
        {pending.step.error !== null && <span className="truncate text-[11px] text-destructive">{pending.step.error}</span>}
      </span>
      <ActionButton stage={stage} step={pending.step} threadId={threadId} wide />
    </div>
  );
}

/** Что шаг сделал: адрес PR открывается, тема коммита и ключи задач читаются текстом. */
function StepDetail({ detail }: { detail: string | null | undefined }) {
  const navigate = useBbNavigate();
  const view = stepDetail(detail);
  if (view === null) return null;
  if (view.kind === "text")
    return (
      <span data-step-detail title={view.text} className="min-w-0 truncate text-muted-foreground">
        {view.text}
      </span>
    );
  return (
    <button
      type="button"
      data-step-detail
      data-step-detail-link
      title={view.url}
      onClick={() => navigate.openUrl(view.url)}
      className="min-w-0 truncate text-left text-muted-foreground underline decoration-foreground/35 underline-offset-2 hover:text-primary"
    >
      {view.label}
    </button>
  );
}

/**
 * Строки шагов автоматизации под её этапом; у упавшего — ошибка, «Повторить» и «Пропустить» — когда эффект уже есть, например PR открыт руками.
 * `threadId` — тред, который ведёт прогон; `null` — прогон ведёт другой тред, и шаги отсюда только видны.
 */
export function AutomationSteps({ stage, threadId }: { stage: ProgressStage; threadId: string | null }) {
  const t = useMessages();
  const label = useStepLabel();
  const rpc = useRpc<typeof automationRpcContract>();
  const [busy, setBusy] = useState(false);
  const steps = stage.automation?.steps ?? [];
  return (
    <div role="list" aria-label={t.progress.steps(stage.name)} className="flex flex-col">
      {steps.map((step, i) => (
        <div key={`${i}-${step.id}`} role="listitem" data-progress-step className={cn(COLUMNS, "min-h-6 px-3 py-0.5 text-[11px]")}>
          <span />
          <span />
          {/* Название и кнопки — одной переносимой ячейкой: где кнопкам не хватает места рядом с названием, они уходят строкой ниже, а не выводят строку за край списка. */}
          <span className="flex min-w-0 flex-wrap items-baseline justify-end gap-x-2">
            {/* Ошибка — своей строкой под названием шага и целиком: в одной строке с названием она обрезалась на полуслове. */}
            <span className="flex min-w-0 flex-[1_1_8rem] flex-col pl-3">
              <span data-step-name className="flex min-w-0 items-baseline gap-2">
                <span title={label(step)} className={cn("max-w-full shrink-0 truncate", step.state === "todo" && "text-muted-foreground", step.state === "fail" && "text-destructive")}>
                  {label(step)}
                </span>
                {step.error === null && <StepDetail detail={step.detail} />}
              </span>
              {step.error !== null && (
                <span data-step-error className="min-w-0 whitespace-normal break-words text-muted-foreground">
                  {step.error}
                </span>
              )}
            </span>
            {threadId === null ? null : stage.kind === "action" ? (
              step.state === "wait" || step.state === "now" || step.state === "fail" ? (
                <ActionButton stage={stage} step={step} threadId={threadId} />
              ) : null
            ) : step.skipQueued ? (
              <span data-skip-queued className="whitespace-nowrap px-1.5 text-[11px] text-muted-foreground">
                {t.progress.skipQueued}
              </span>
            ) : step.state === "fail" ? (
              <span className="flex flex-wrap items-baseline justify-end gap-x-0.5">
                {step.retryAt !== null && <RetryCountdown at={step.retryAt} />}
                {(["retryAutomation", "skipAutomationStep"] as const).map((method) => (
                  <button
                    key={method}
                    type="button"
                    aria-label={method === "retryAutomation" ? t.progress.retryStep(label(step)) : t.progress.skipStep(label(step))}
                    disabled={busy}
                    onClick={() => {
                      setBusy(true);
                      void reportStepAnswer(rpc.call(method, { threadId, stage: stage.id }), stage.name, t).finally(() => setBusy(false));
                    }}
                    className={cn("rounded px-1.5 text-[11px] hover:bg-state-hover disabled:opacity-50", method === "retryAutomation" ? "text-foreground" : "text-muted-foreground")}
                  >
                    {method === "retryAutomation" ? t.progress.retry : t.progress.skip}
                  </button>
                ))}
              </span>
            ) : null}
          </span>
          <span />
          <span />
          <Mark state={step.state} live={stage.live} />
        </div>
      ))}
    </div>
  );
}

/** Сколько осталось до автоповтора упавшего шага, посекундно; срок вышел — ноль, пока опрос не принесёт исход повтора. */
function RetryCountdown({ at }: { at: string }) {
  const t = useMessages();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <span className="whitespace-nowrap pr-1 text-muted-foreground">{t.progress.retryIn(Math.max(0, Math.ceil((Date.parse(at) - now) / 1000)))}</span>;
}

/** Отметка справа: сделано, идёт, упало, впереди. */
function Mark({ state, live }: { state: StepView["state"]; live: boolean | undefined }) {
  return (
    <span className="flex size-5 items-center justify-center">
      {state === "done" ? (
        <Icon name="Check" aria-hidden="true" className="size-3.5" />
      ) : state === "now" ? (
        <span aria-hidden="true" {...pulse(live)} className="size-1.5 rounded-full bg-foreground" />
      ) : state === "fail" ? (
        <Icon name="X" aria-hidden="true" className="size-3.5 text-destructive" />
      ) : (
        <span aria-hidden="true" className="size-3 rounded-full border border-border" />
      )}
    </span>
  );
}

export const money = (value: number): string => `$${Number.isInteger(value) ? value : value.toFixed(1)}`;

/**
 * Колонки строк: номер, значок, середина, минуты, доллары, отметка.
 * Номер держит свою колонку слева от значка, поэтому номера стоят в столбец и не уезжают
 * от длины названия, а строка без номера оставляет колонку пустой. Минуты и доллары —
 * колонками постоянной ширины: строка без долларов не сдвигает минуты в их колонку.
 */
const COLUMNS = "grid grid-cols-[16px_16px_minmax(0,1fr)_2.75rem_3.25rem_20px] items-center gap-2.5";

export function ProgressBanner() {
  return (
    <LocaleProvider>
      <ProviderLogosProvider>
        <Banner />
      </ProviderLogosProvider>
    </LocaleProvider>
  );
}

function Banner() {
  const { scope } = useComposerView();
  const threadId = scope.kind === "thread" ? scope.threadId : null;
  const { view, drop } = useProgress(threadId);
  const [open, setOpen] = useState(false);
  if (threadId === null || view === undefined) return null;
  // Тред без идущего прогона — до первого и после завершённого — на месте бара строка выбора flow: прогон начнётся с сообщением владельца.
  // Кроме треда, который работу отдал: итог лёг в ленту носителя, и здесь, чем кончилась работа, видно только по баннеру.
  if (view === null || (view.finished === true && view.carrier === undefined)) return <FlowChoice threadId={threadId} />;
  if (view.total === 0) return null;
  // Свой экземпляр на тред: переключения этапов, ещё не подтверждённые опросом, не переходят в другой тред.
  return <Progress key={threadId} view={view} threadId={threadId} open={open} toggle={() => setOpen((value) => !value)} onCancelled={() => {
    setOpen(false);
    drop();
  }} />;
}

/** Прогон треда: `undefined` — сервер ещё не ответил, `null` — прогона нет; `drop` снимает его сразу, не дожидаясь опроса. */
function useProgress(threadId: string | null): { view: ProgressView | null | undefined; drop: () => void } {
  const rpc = useRpc<typeof progressRpcContract>();
  // Клиент RPC приходит новым объектом на каждый рендер: без ссылки опрос перезапускался бы каждую перерисовку.
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const [view, setView] = useState<ProgressView | null | undefined>(undefined);
  useEffect(() => {
    if (threadId === null) return;
    let alive = true;
    const pull = () =>
      rpcRef.current.call("getFlowProgress", { threadId }).then(
        (next) => alive && setView(next),
        // Баннер — справка: пропущенный такт не стоит тоста.
        () => undefined,
      );
    void pull();
    const timer = setInterval(() => void pull(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [threadId]);
  return { view, drop: () => setView(null) };
}

/** Корни файлов прогона: окружение — из вида прогона, он помнит его и у замороженного итога; хранилище — у bb. */
export function useRunRoots(threadId: string, environmentId: string | null): FileRoots | null {
  const roots = useFileRoots(threadId);
  return roots === null ? null : { ...roots, environmentId };
}

/** Подсказка ячейки минут: простой этапа с шагами — словами его вида, у этапа без шагов — полное время, и только когда оно другое. */
function spentTitle(t: ReturnType<typeof useMessages>, { minutes, wall, idle, kind }: { minutes: number | null; wall: number | null; idle: number | null; kind: ProgressStage["kind"] }): string | undefined {
  if (minutes === null) return undefined;
  if (idle !== null && idle > 0) return kind === "action" ? t.progress.waitedFor(minutes, idle) : t.progress.brokenFor(minutes, idle);
  return wall !== null && wall !== minutes ? t.progress.spentOf(minutes, wall) : undefined;
}

/** Ячейки минут и долларов строки — каждая своей колонкой; пустая ячейка держит место. `plan` — прогноз: с тильдой и едва заметно, как вычеркнутый этап. */
function Cells({ minutes, cost, title, plan = false }: { minutes: number | null; cost: number | null; title?: string | undefined; plan?: boolean }) {
  const t = useMessages();
  const mark = plan ? "~" : "";
  return (
    <>
      <span data-progress-minutes data-progress-spent {...(title === undefined ? {} : { title })} className={cn("whitespace-nowrap text-right tabular-nums leading-5", plan && "opacity-40")}>
        {minutes === null ? "" : `${mark}${t.progress.minutes(minutes)}`}
      </span>
      <span data-progress-cost className={cn("whitespace-nowrap text-right tabular-nums leading-5", plan && "opacity-40")}>
        {cost === null ? "" : `${mark}${money(cost)}`}
      </span>
    </>
  );
}

/** Факт пройденного этапа, план этапа впереди или идущего; у остальных ячейки пусты. */
function Spent({ stage }: { stage: ProgressStage }) {
  const t = useMessages();
  if (stage.state === "done") {
    const title = spentTitle(t, { minutes: stage.minutes, wall: stage.wallMinutes ?? null, idle: stage.idleMinutes ?? null, kind: stage.kind });
    return <Cells minutes={stage.minutes} cost={stage.cost} title={title} />;
  }
  return stage.plan === undefined ? <Cells minutes={null} cost={null} /> : <Cells minutes={stage.plan.minutes} cost={stage.plan.target} plan />;
}

/**
 * `onToggle` — у живого бара треда, который ведёт прогон: этап, до которого прогон не дошёл, получает чекбокс «в прогоне».
 * `onExpand` — у строки, которой есть что развернуть: название становится кнопкой аккордеона.
 */
export function Row({ stage, roots, onToggle, expanded = false, onExpand, subOf }: { stage: ProgressStage; roots: FileRoots | null; onToggle?: (run: boolean) => void; expanded?: boolean; onExpand?: () => void; subOf?: ProgressStage | undefined }) {
  const t = useMessages();
  const first = stage.results[0];
  const muted = stage.state === "todo" || stage.state === "skip";
  return (
    // Строка выше одной: содержимое переносится, поэтому номер и значок держатся верхней строки, а не середины столбца.
    // Вычеркнутая из прогона — приглушена вся, прозрачностью: приглушённый цвет текста в теме bb почти не отличается от основного.
    <div data-progress-row className={cn(COLUMNS, "min-h-7 items-start px-3 py-1", (stage.state === "now" || stage.state === "fail") && "bg-state-active", stage.state === "skip" && "opacity-40")}>
      {stage.number === null || stage.number === undefined ? (
        <span aria-hidden="true" />
      ) : (
        <span data-progress-number className="text-right tabular-nums leading-5 text-muted-foreground">
          {stage.number}
        </span>
      )}
      <StageIcon stage={stage} className={cn("mt-0.5", muted ? "text-muted-foreground" : "text-foreground")} />
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5 leading-5">
        {onExpand === undefined ? (
          <span data-progress-label className={cn(muted && "text-muted-foreground", stage.state === "skip" && "line-through")}>{stageLabel(stage, t.stages)}</span>
        ) : (
          <button type="button" data-progress-label aria-expanded={expanded} aria-label={t.progress.details(stageLabel(stage, t.stages))} onClick={onExpand} className={cn("inline-flex items-baseline gap-1 rounded text-left hover:text-primary", muted && "text-muted-foreground")}>
            {stageLabel(stage, t.stages)}
            <Icon name="ChevronRight" aria-hidden="true" className={cn("size-3 shrink-0 self-center text-muted-foreground transition-transform", expanded && "rotate-90")} />
          </button>
        )}
        {stage.state === "done" && first !== undefined ? (
          <>
            <ResultAnchor target={first.target} roots={roots} className="min-w-0 break-all text-left underline decoration-foreground/35 underline-offset-2 hover:text-primary">
              {first.label}
            </ResultAnchor>
            {stage.results.length > 1 && !expanded && (
              // Счёт остальных — та же кнопка аккордеона: за ним и прячутся остальные результаты; для диктора она уже названа выше.
              <button type="button" tabIndex={-1} aria-hidden="true" onClick={onExpand} className="shrink-0 text-[11px] text-muted-foreground hover:text-primary">
                +{stage.results.length - 1}
              </button>
            )}
          </>
        ) : (
          <span className="min-w-0 text-[11px] text-muted-foreground">
            {stage.state === "fail"
              ? t.progress.failed
              : stage.state === "now"
                ? stage.kind === "action"
                  ? actionNote(stage, t)
                  : stage.automation !== undefined
                    ? t.progress.automationRunning
                    : stage.kind === "skill"
                      ? t.progress.running
                      : t.progress.waiting
                : stage.state === "skip"
                  ? t.progress.skipped
                  : ""}
          </span>
        )}
      </span>
      <Spent stage={stage} />
      <span className="flex size-5 items-center justify-center">
        {stage.state === "done" && first !== undefined ? (
          <ResultAnchor target={first.target} roots={roots} label={t.progress.open(first.label)} className="flex size-5 items-center justify-center rounded hover:bg-state-hover hover:text-primary">
            <Icon name="ExternalLink" aria-hidden="true" className="size-3.5" />
          </ResultAnchor>
        ) : stage.state === "done" ? (
          <Icon name="Check" aria-hidden="true" className="size-3.5" />
        ) : stage.state === "now" ? (
          <span aria-hidden="true" {...pulse(stage.live)} className="size-1.5 rounded-full bg-foreground" />
        ) : stage.state === "fail" ? (
          <Icon name="X" aria-hidden="true" className="size-3.5 text-destructive" />
        ) : onToggle !== undefined ? (
          <StageCheckbox
            inRun={stage.state === "todo"}
            label={subOf === undefined ? t.flowChoice.inRun(stageLabel(stage, t.stages)) : t.subStages.inRun(stageLabel(stage, t.stages), stageLabel(subOf, t.stages))}
            // Под-этап включается и выключается только вместе с владельцем: его чекбокс показывает, но не нажимается.
            onToggle={subOf === undefined ? onToggle : null}
          />
        ) : stage.state === "skip" ? (
          <span aria-hidden="true" className="h-px w-2.5 bg-muted-foreground" />
        ) : (
          <span aria-hidden="true" className="size-3 rounded-full border border-border" />
        )}
      </span>
    </div>
  );
}

/** Есть ли строке что развернуть: результаты сверх первого или шаги автоматизации, до которой прогон дошёл. */
const expandable = (stage: ProgressStage): boolean =>
  stage.state !== "todo" && stage.state !== "skip" && (stage.results.length > 1 || (stage.automation?.steps.length ?? 0) > 0);

/** Развёрнута ли строка, пока владелец её не трогал: идущая и упавшая автоматизация — да, её шаги и кнопки нужны сейчас. */
const openByDefault = (stage: ProgressStage): boolean => stage.automation !== undefined && (stage.state === "now" || stage.state === "fail");

/** Результаты сверх первого — по строке на каждый, под серединой строки этапа. */
function MoreResults({ stage, roots }: { stage: ProgressStage; roots: FileRoots | null }) {
  return (
    <div className="flex flex-col">
      {stage.results.slice(1).map((result) => (
        <div key={result.target} data-progress-result className={cn(COLUMNS, "min-h-6 px-3 py-0.5")}>
          <span />
          <span />
          <ResultAnchor target={result.target} roots={roots} className="min-w-0 break-all text-left underline decoration-foreground/35 underline-offset-2 hover:text-primary">
            {result.label}
          </ResultAnchor>
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}

/** Последняя строка списка: сколько потрачено на пройденных этапах — в колонках минут и долларов. */
function TotalRow({ stages }: { stages: readonly ProgressStage[] }) {
  const t = useMessages();
  const done = stages.filter((stage) => stage.state === "done");
  const sum = (values: ReadonlyArray<number | null>) => (values.every((value) => value === null) ? null : values.reduce<number>((total, value) => total + (value ?? 0), 0));
  return (
    <div data-progress-total className={cn(COLUMNS, "min-h-7 border-t border-border px-3 py-1 text-muted-foreground")}>
      <span />
      <span />
      <span className="leading-5">{t.progress.total}</span>
      <Cells minutes={sum(done.map((stage) => stage.minutes))} cost={sum(done.map((stage) => stage.cost))} />
      <span />
    </div>
  );
}

/**
 * Этапы прогона строками-аккордеонами и итог потраченного под ними — общий для бара над композером и итога в ленте.
 * `threadId` — тред, который ведёт прогон: из него нажимаются шаги автоматизаций; `null` — шаги только видны.
 * `toggleOf` — чекбокс «в прогоне» у этапа; нет — у этапа чекбокса нет.
 */
export function StageList({ stages, roots, threadId, toggleOf }: { stages: readonly ProgressStage[]; roots: FileRoots | null; threadId: string | null; toggleOf?: (stage: ProgressStage, at: number) => ((run: boolean) => void) | undefined }) {
  const [touched, setTouched] = useState<Readonly<Record<string, boolean>>>({});
  // Под-этапы свёрнуты под строкой владельца: она раскрывается и ради них, а идущий или упавший под-этап раскрывает её сам.
  const subsOf = (id: string) => stages.filter((stage) => stage.parent === id);
  const item = (stage: ProgressStage, nested: boolean): ReactNode => {
    const subs = subsOf(stage.id);
    const canOpen = expandable(stage) || subs.length > 0;
    const open = canOpen && (touched[stage.id] ?? (openByDefault(stage) || subs.some((sub) => sub.state === "now" || sub.state === "fail")));
    const toggle = toggleOf?.(stage, stages.indexOf(stage));
    return (
      <div key={stage.id} className="flex flex-col">
        <Row
          stage={stage}
          roots={roots}
          {...(toggle === undefined ? {} : { onToggle: toggle })}
          {...(nested ? { subOf: stages.find((owner) => owner.id === stage.parent) } : {})}
          expanded={open}
          {...(canOpen ? { onExpand: () => setTouched((current) => ({ ...current, [stage.id]: !open })) } : {})}
        />
        {open && stage.results.length > 1 && <MoreResults stage={stage} roots={roots} />}
        {open && stage.automation !== undefined && <AutomationSteps stage={stage} threadId={threadId} />}
        {open && subs.length > 0 && <div className="ml-6 flex flex-col border-l border-border">{subs.map((sub) => item(sub, true))}</div>}
      </div>
    );
  };
  return (
    <>
      {stages.filter((stage) => stage.parent === undefined).map((stage) => item(stage, false))}
      {stages.some((stage) => stage.state === "done") && <TotalRow stages={stages} />}
    </>
  );
}

/**
 * Этапы бара с переключениями владельца поверх ответа сервера: чекбокс меняется сразу, а не со следующим опросом.
 * Переключение держится, пока опрос не покажет то же состояние; отказ сервера его снимает.
 */
function useStageToggles(stages: readonly ProgressStage[], threadId: string) {
  const rpc = useRpc<typeof progressRpcContract>();
  const [toggled, setToggled] = useState<Readonly<Record<string, "todo" | "skip">>>({});
  const settled = (id: string) => setToggled(({ [id]: _, ...rest }) => rest);
  useEffect(() => {
    const confirmed = stages.filter((stage) => toggled[stage.id] === stage.state).map((stage) => stage.id);
    if (confirmed.length > 0) setToggled((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !confirmed.includes(id))));
  }, [stages, toggled]);
  // Связка переключается сразу вся (`runCascade`), а сервер зовётся один раз: каскад он делает сам тем же правилом.
  const toggleStage = (stageId: string, run: boolean) => {
    const ids = runCascade(stages, stageId, run).filter((id) => stages.some((stage) => stage.id === id && (stage.state === "todo" || stage.state === "skip")));
    const settleAll = () => ids.forEach(settled);
    setToggled((current) => ({ ...current, ...Object.fromEntries(ids.map((id) => [id, run ? "todo" : "skip"])) }));
    rpc.call("setStageInRun", { threadId, stageId, run }).then(
      (answer) => answer.kind === "failed" && settleAll(),
      settleAll,
    );
  };
  const shown = stages.map((stage) => {
    const state = toggled[stage.id];
    return state !== undefined && (stage.state === "todo" || stage.state === "skip") ? { ...stage, state } : stage;
  });
  return { stages: shown, toggleStage };
}

/** «⋯» в строке имени flow: «Отменить flow» через подтверждение. */
function FlowMenu({ threadId, onCancelled }: { threadId: string; onCancelled: () => void }) {
  const t = useMessages();
  const rpc = useRpc<typeof flowChoiceRpcContract>();
  const [confirming, setConfirming] = useState(false);
  const cancel = () => {
    onCancelled();
    // Сбой не возвращает бар силой: следующий опрос покажет прогон, если он остался.
    rpc.call("cancelFlow", { threadId }).catch(() => undefined);
  };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={t.flowChoice.menu} className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-state-hover hover:text-foreground">
            <Icon name="MoreHorizontal" aria-hidden="true" className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" collisionPadding={8}>
          <DropdownMenuItem className="text-destructive" onSelect={() => setConfirming(true)}>
            <FlowMark crossed className="size-3.5" />
            {t.flowChoice.cancel}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog open={confirming} onOpenChange={setConfirming} title={t.flowChoice.cancelTitle} description={t.flowChoice.cancelText} cancelLabel={t.flowChoice.keep} confirmLabel={t.flowChoice.cancel} onConfirm={cancel} />
    </>
  );
}

/** Начало жеста: точка, с которой пошёл палец, высота списка на тот момент и пройденное вниз расстояние. */
type Pull = { startY: number; height: number; offset: number };

/**
 * Движение пальца вниз по списку — наш жест, а не браузера.
 *
 * React вешает `onTouchMove` пассивным слушателем, поэтому `preventDefault`
 * внутри обработчика ничего не делает: браузер доводил свайп сам и уносил
 * вместе с ним всю страницу — композер подпрыгивал вверх, под ним оставалась
 * пустая полоса экрана. Пока список стоит в самом верху и палец идёт вниз,
 * движение наше и отменяется; в любом другом случае это обычная прокрутка
 * списка, и её браузеру оставляют.
 */
function usePullDown(pull: { current: Pull | null }, open: boolean) {
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const list = listRef.current;
    if (list === null) return;
    const onMove = (event: TouchEvent) => {
      const start = pull.current;
      const y = event.touches[0]?.clientY;
      if (start === null || y === undefined) return;
      start.offset = pullOffset({ scrollTop: list.scrollTop, movedDown: y - start.startY, height: start.height });
      if (start.offset === 0) {
        list.style.height = "";
        return;
      }
      event.preventDefault();
      list.style.height = `${start.height - start.offset}px`;
    };
    list.addEventListener("touchmove", onMove, { passive: false });
    return () => list.removeEventListener("touchmove", onMove);
  }, [open, pull]);
  return listRef;
}

function Progress({ view, threadId, open, toggle, onCancelled }: { view: ProgressView; threadId: string; open: boolean; toggle: () => void; onCancelled: () => void }) {
  const t = useMessages();
  // Результаты лежат там, куда их положил тред, который ведёт прогон: в его дереве и в его хранилище.
  const roots = useRunRoots(view.carrier?.threadId ?? threadId, view.environmentId ?? null);
  const pull = useRef<Pull | null>(null);
  const listRef = usePullDown(pull, open);
  const current = view.stages.find((s) => s.id === view.current) ?? view.stages[view.stages.length - 1]!;
  // Прогон, который ведёт другой тред, отсюда только виден: шаги автоматизаций и Action нажимаются в треде-носителе.
  const driver = view.carrier === undefined ? threadId : null;
  const waiting = driver === null ? undefined : view.stages.find((stage) => pendingStep(stage) !== null);
  const { stages, toggleStage } = useStageToggles(view.stages, threadId);
  // Переключать можно только этапы впереди прогона — после последнего, до которого он дошёл; убранный позади агент уже миновал.
  const reached = Math.max(-1, ...view.stages.map((stage, at) => (stage.state === "done" || stage.state === "now" || stage.state === "fail" ? at : -1)));
  return (
    // bb кладёт баннеры в сетку с отступом mb-2 до композера: последний баннер съедает его и ещё пиксель рамки, чтобы стать шапкой композера.
    <div className="mx-2.5 -mb-px overflow-hidden last:-mb-[calc(0.5rem+1px)] rounded-t-[10px] border border-b-0 border-border bg-surface-recessed-solid text-xs">
      <style>{mutedBlinkKeyframes}</style>
      {open && (
        // Список листается сам в себе: прокрутка не уходит в ленту треда, а движение вниз от его верха тянет баннер — на телефоне закрыть его иначе нечем, кроме прицельного тапа по шапке. Баннер прижат к композеру снизу, поэтому «ехать за пальцем» — это уменьшать высоту списка: его верхний край идёт вниз вместе с пальцем.
        <div
          ref={listRef}
          data-progress-list
          className="flex max-h-[50vh] flex-col gap-px overflow-y-auto overscroll-contain pt-1"
          onTouchStart={(event) => {
            const y = event.touches[0]?.clientY;
            event.currentTarget.style.transition = "none";
            pull.current = y === undefined ? null : { startY: y, height: event.currentTarget.clientHeight, offset: 0 };
          }}
          onTouchEnd={(event) => {
            const start = pull.current;
            pull.current = null;
            const list = event.currentTarget;
            if (start === null || list.style.height === "") {
              list.style.transition = "";
              return;
            }
            // Доводка после отпускания: список доезжает до конца и закрывает баннер либо возвращается на место — но не исчезает под пальцем рывком.
            list.style.transition = `height ${PULL_SETTLE_MS}ms ${SETTLE_EASING}`;
            list.style.height = settlesClosed({ offset: start.offset, height: start.height }) ? "0px" : `${start.height}px`;
          }}
          onTransitionEnd={(event) => {
            if (event.propertyName !== "height" || event.currentTarget !== event.target) return;
            const list = event.currentTarget;
            if (list.style.height === "0px") {
              toggle();
              return;
            }
            list.style.transition = "";
            list.style.height = "";
          }}
        >
          {view.flowName !== undefined && (
            <div data-progress-flow className="flex items-center gap-1.5 px-3 pb-0.5 pt-1 text-[11px] text-muted-foreground">
              <span title={view.flowName} className="min-w-0 flex-1 truncate">{view.flowName}</span>
              {/* Отменить прогон может только тред, который его ведёт: тред, отдавший работу, его только видит. */}
              {driver !== null && <FlowMenu threadId={driver} onCancelled={onCancelled} />}
            </div>
          )}
          <StageList stages={stages} roots={roots} threadId={driver} toggleOf={(stage, at) => (driver === null || at <= reached ? undefined : (run) => toggleStage(stage.id, run))} />
        </div>
      )}
      {view.carrier !== undefined && (
        <div data-progress-carrier className="flex items-center gap-1.5 px-3 pt-1.5 text-[11px] text-muted-foreground">
          <Icon name="Fork" aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="truncate">{t.progress.carriedBy(view.carrier.title ?? view.carrier.threadId)}</span>
        </div>
      )}
      {/* Слева — номер идущего этапа и общее число: значок этапа переехал на свой сегмент полосы, и ячейка под него больше не нужна.
          Вслух номер читается словами — это в aria-label: «11/14» экранному диктору ничего не говорит. */}
      <button
        type="button"
        aria-expanded={open}
        aria-label={t.progress.label(stageLabel(current, t.stages), view.step, view.total)}
        onClick={toggle}
        className="grid min-h-[34px] w-full grid-cols-[auto_16px_minmax(0,1fr)_auto_20px] items-center gap-2.5 px-3 py-1.5 text-left hover:bg-state-hover"
      >
        {/* Сначала счёт сделанного, затем значок идущего этапа, и только потом полоса: полоса отвечает «где», числа — «сколько». */}
        <span data-progress-count className="shrink-0 tabular-nums">{t.progress.count(view.done, view.total)}</span>
        <span data-head-icon className="flex justify-center">
          <StageIcon stage={current} />
        </span>
        {/* Обе полосы — одна ячейка: заполненность окна идёт ровно под этапами и ровно той же длины. */}
        <span className="flex min-w-10 flex-col gap-[3px]">
          <span aria-hidden="true" className="flex h-1 gap-0.5">
            {view.stages.filter((stage) => stage.state !== "skip").map((stage) => (
              <i
                key={stage.id}
                data-progress-segment
                {...pulse(stage.live)}
                className={cn(
                  // Каждый сегмент — свой слой: иначе пульсирующий снапится к пикселю иначе, чем соседи, и встаёт ниже.
                  "relative flex-1 rounded-sm [will-change:opacity]",
                  stage.state === "done"
                    ? "bg-foreground"
                    : stage.state === "fail"
                      ? "bg-destructive"
                      : stage.state === "now"
                        ? "bg-foreground/45"
                        : "bg-state-active",
                )}
              >
              </i>
            ))}
          </span>
          {view.context !== undefined && <ContextBar fill={view.context} />}
        </span>
        {view.planned === null ? (
          <span />
        ) : (
          <span className="flex justify-end gap-1.5 whitespace-nowrap tabular-nums text-muted-foreground">
            {view.planned.minutes !== null && <span>{t.progress.minutes(view.planned.minutes)}</span>}
            <span>{view.planned.target === view.planned.max ? money(view.planned.target) : `${money(view.planned.target)}–${money(view.planned.max).slice(1)}`}</span>
          </span>
        )}
        <Icon name="ChevronDown" aria-hidden="true" className={cn("size-3.5 text-muted-foreground", open && "rotate-180")} />
      </button>
      {/* Свёрнутая полоса прячет шаги — ждущий шаг Action показывается своей строкой, иначе кнопку негде нажать. */}
      {!open && waiting !== undefined && driver !== null && <ActionBar stage={waiting} threadId={driver} />}
    </div>
  );
}
