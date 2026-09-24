// Баннер прогресса flow над композером треда: шапкой композера — номер идущего
// этапа и общее число, сегменты этапов со значком идущего поверх его сегмента и
// план времени и бюджета; тап раскрывает над шапкой список этапов. Опрос RPC раз
// в 5 секунд — прогресс пишут бриф, ответ, отметки агента и исполнитель
// автоматизаций. Этап, на котором идёт работа, приглушённо мерцает значком; под
// строкой автоматизации — её шаги с тем, что каждый сделал, и повтором упавшего.
import { useEffect, useRef, useState } from "react";
import { useBbNavigate, useComposerView, useRpc } from "@get-bb/plugin-sdk/app";

import { contextPercent, contextTone, shortTokens } from "../core/context";
import { mutedBlinkAnimation, mutedBlinkKeyframes } from "../core/muted-blink";
import { PULL_SETTLE_MS, pullOffset, settlesClosed } from "../core/pull-to-collapse";
import { fileTarget, resultLink, stepDetail } from "../core/result-link";
import { stageLabel } from "../core/stages";
import { Icon } from "../components/ui/icon";
import { cn } from "../lib/utils";
import type { ContextFillView, ProgressStage, ProgressView, automationRpcContract, filesRpcContract, progressRpcContract } from "../shared/contract";
import { LocaleProvider } from "./locale";
import { ProviderLogosProvider } from "./provider-logos-source";
import { ProviderMark } from "./provider-logos";
import { useMessages } from "./locale-context";
import { BUILTIN_AUTOMATION_ICON, KIND_ICONS } from "./stage-icons";

/** Тон заливки занятого окна: те же семантические токены, что у остальных состояний баннера. */
const CONTEXT_TONES = { normal: "bg-primary", warn: "bg-warning", alert: "bg-destructive" } as const;

/**
 * Вторая полоса шапки: доля занятого окна контекста под полосой этапов. Числа
 * и пороги приезжают готовыми в ответе баннера — здесь только заливка и тон.
 */
function ContextBar({ fill }: { fill: ContextFillView }) {
  const t = useMessages();
  // Один процент на ширину, подпись и тон: считай тон по точной доле — полоса,
  // подписанная «25%», рядом с «жёлтая с 25%» оставалась бы обычного тона.
  const percent = contextPercent(fill.share);
  const { warnPercent, alertPercent } = fill;
  return (
    <span
      data-context-bar
      title={t.progress.context(percent, shortTokens(fill.usedTokens), shortTokens(fill.windowTokens), warnPercent, alertPercent)}
      className="flex h-1 overflow-hidden rounded-sm bg-state-active"
    >
      <i data-context-used aria-hidden="true" style={{ width: `${percent}%` }} className={cn("rounded-sm", CONTEXT_TONES[contextTone(percent, { warnPercent, alertPercent })])} />
    </span>
  );
}

const POLL_MS = 5000;

/** Кривая доводки списка после отпускания пальца — та же, что у шторок кита. */
const SETTLE_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";

/** Иконки исполнителя этапа навыка без логотипа провайдера: ромб — сам, агент, workflow. */
const EXECUTOR_ICONS = { self: "Diamond", agent: "Bot", workflow: "Workflow" } as const;

const iconOf = (stage: ProgressStage): string =>
  stage.kind === "action" ? KIND_ICONS.action : stage.automation !== undefined ? BUILTIN_AUTOMATION_ICON : stage.kind === "skill" ? EXECUTOR_ICONS[stage.executor] : KIND_ICONS[stage.kind];

/** У этапа навыка, который ведёт сам агент или субагент, — логотип провайдера исполнителя. */
const byProvider = (stage: ProgressStage): boolean => stage.automation === undefined && stage.kind === "skill" && stage.executor !== "workflow";

/** Приглушённое мерцание элемента, на этапе которого идёт работа; кадры кладёт полоса. */
export const pulse = (live: boolean | undefined) => (live === true ? { "data-pulse": "", style: { animation: mutedBlinkAnimation } } : {});

/** Значок этапа: мерцает, пока на этапе идёт работа. */
export function StageIcon({ stage, className }: { stage: ProgressStage; className?: string }) {
  return (
    <span data-stage-icon {...pulse(stage.live)} className={cn("flex items-center justify-center", stage.state === "fail" && "text-destructive")}>
      {byProvider(stage) ? (
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
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[11.5px] font-semibold",
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
      {step.state === "fail" ? t.progress.retry : busy ? t.progress.actionBusy : label(step)}
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
          <span className="flex min-w-0 items-baseline gap-2 pl-3">
            <span className={cn("shrink-0 whitespace-nowrap", step.state === "todo" && "text-muted-foreground", step.state === "fail" && "text-destructive")}>{label(step)}</span>
            {step.error !== null && (
              <span title={step.error} className="min-w-0 truncate text-muted-foreground">
                {step.error}
              </span>
            )}
            {step.error === null && <StepDetail detail={step.detail} />}
          </span>
          {threadId === null ? (
            <span />
          ) : stage.kind === "action" ? (
            step.state === "wait" || step.state === "now" || step.state === "fail" ? (
              <ActionButton stage={stage} step={step} threadId={threadId} />
            ) : (
              <span />
            )
          ) : step.state === "fail" ? (
            <span className="flex gap-0.5">
              {(["retryAutomation", "skipAutomationStep"] as const).map((method) => (
                <button
                  key={method}
                  type="button"
                  aria-label={method === "retryAutomation" ? t.progress.retryStep(label(step)) : t.progress.skipStep(label(step))}
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void rpc.call(method, { threadId, stage: stage.id }).finally(() => setBusy(false));
                  }}
                  className={cn("rounded px-1.5 text-[11px] hover:bg-state-hover disabled:opacity-50", method === "retryAutomation" ? "text-foreground" : "text-muted-foreground")}
                >
                  {method === "retryAutomation" ? t.progress.retry : t.progress.skip}
                </button>
              ))}
            </span>
          ) : (
            <span />
          )}
          <Mark state={step.state} live={stage.live} />
        </div>
      ))}
    </div>
  );
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
 * Колонки шапки и строк: номер, значок, середина, минуты и доллары вплотную, отметка.
 * Номер держит свою колонку слева от значка, поэтому номера стоят в столбец и не уезжают
 * от длины названия, а строка без номера оставляет колонку пустой.
 */
const COLUMNS = "grid grid-cols-[16px_16px_minmax(0,1fr)_auto_20px] items-center gap-2.5";

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
  const view = useProgress(threadId);
  const [open, setOpen] = useState(false);
  // Завершённый прогон уходит с композера: полоса над ним означает идущую работу, а итог рисуется в ленте.
  // Кроме треда, который работу отдал: итог лёг в ленту носителя, и здесь, чем кончилась работа, видно только по баннеру.
  if (threadId === null || view === null || view.total === 0 || (view.finished === true && view.carrier === undefined)) return null;
  return <Progress view={view} threadId={threadId} open={open} toggle={() => setOpen((value) => !value)} />;
}

function useProgress(threadId: string | null): ProgressView | null {
  const rpc = useRpc<typeof progressRpcContract>();
  // Клиент RPC приходит новым объектом на каждый рендер: без ссылки опрос перезапускался бы каждую перерисовку.
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const [view, setView] = useState<ProgressView | null>(null);
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
  return view;
}

export function useOpenResult(threadId: string, environmentId: string | null) {
  const rpc = useRpc<typeof filesRpcContract>();
  const navigate = useBbNavigate();
  return (target: string) => {
    const link = resultLink(target);
    if (link.kind === "url") navigate.openUrl(link.url);
    else if (link.kind === "workspace") environmentId !== null && navigate.experimental_openFilePreview({ target: { kind: "workspace", environmentId, path: link.path }, location: null });
    else
      void rpc.call("threadStorage", { threadId }).then(
        (where) => where.kind === "found" && navigate.experimental_openFilePreview({ target: fileTarget(link.path, { threadId, ...where }), location: null }),
        () => undefined,
      );
  };
}

/** Подсказка ячейки минут: простой этапа с шагами — словами его вида, у этапа без шагов — полное время, и только когда оно другое. */
function spentTitle(t: ReturnType<typeof useMessages>, { minutes, wall, idle, kind }: { minutes: number | null; wall: number | null; idle: number | null; kind: ProgressStage["kind"] }): string | undefined {
  if (minutes === null) return undefined;
  if (idle !== null && idle > 0) return kind === "action" ? t.progress.waitedFor(minutes, idle) : t.progress.brokenFor(minutes, idle);
  return wall !== null && wall !== minutes ? t.progress.spentOf(minutes, wall) : undefined;
}

function Spent({ minutes, wall, idle, kind, cost }: { minutes: number | null; wall: number | null; idle: number | null; kind: ProgressStage["kind"]; cost: number | null }) {
  const t = useMessages();
  const title = spentTitle(t, { minutes, wall, idle, kind });
  return (
    <span data-progress-spent {...(title === undefined ? {} : { title })} className="flex justify-end gap-1.5 whitespace-nowrap tabular-nums">
      {minutes !== null && <span className="min-w-8 text-right">{t.progress.minutes(minutes)}</span>}
      {cost !== null && <span className="min-w-10 text-right">{money(cost)}</span>}
    </span>
  );
}

export function Row({ stage, open }: { stage: ProgressStage; open: (target: string) => void }) {
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
        <span data-progress-label className={cn(muted && "text-muted-foreground", stage.state === "skip" && "line-through")}>{stageLabel(stage, t.stages)}</span>
        {stage.state === "done" && first !== undefined ? (
          <>
            <button type="button" onClick={() => open(first.target)} className="min-w-0 break-all text-left underline decoration-foreground/35 underline-offset-2 hover:text-primary">
              {first.label}
            </button>
            {stage.results.length > 1 && <span className="shrink-0 text-[11px] text-muted-foreground">+{stage.results.length - 1}</span>}
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
      <Spent
        minutes={stage.state === "done" ? stage.minutes : null}
        wall={stage.state === "done" ? (stage.wallMinutes ?? null) : null}
        idle={stage.state === "done" ? (stage.idleMinutes ?? null) : null}
        kind={stage.kind}
        cost={stage.state === "done" ? stage.cost : null}
      />
      <span className="flex size-5 items-center justify-center">
        {stage.state === "done" && first !== undefined ? (
          <button type="button" aria-label={t.progress.open(first.label)} onClick={() => open(first.target)} className="flex size-5 items-center justify-center rounded hover:bg-state-hover hover:text-primary">
            <Icon name="ExternalLink" aria-hidden="true" className="size-3.5" />
          </button>
        ) : stage.state === "done" ? (
          <Icon name="Check" aria-hidden="true" className="size-3.5" />
        ) : stage.state === "now" ? (
          <span aria-hidden="true" {...pulse(stage.live)} className="size-1.5 rounded-full bg-foreground" />
        ) : stage.state === "fail" ? (
          <Icon name="X" aria-hidden="true" className="size-3.5 text-destructive" />
        ) : stage.state === "skip" ? (
          <span aria-hidden="true" className="h-px w-2.5 bg-muted-foreground" />
        ) : (
          <span aria-hidden="true" className="size-3 rounded-full border border-border" />
        )}
      </span>
    </div>
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

function Progress({ view, threadId, open, toggle }: { view: ProgressView; threadId: string; open: boolean; toggle: () => void }) {
  const t = useMessages();
  // Результаты лежат там, куда их положил тред, который ведёт прогон: в его дереве и в его хранилище.
  const openResult = useOpenResult(view.carrier?.threadId ?? threadId, view.environmentId ?? null);
  const pull = useRef<Pull | null>(null);
  const listRef = usePullDown(pull, open);
  const current = view.stages.find((s) => s.id === view.current) ?? view.stages[view.stages.length - 1]!;
  // Прогон, который ведёт другой тред, отсюда только виден: шаги автоматизаций и Action нажимаются в треде-носителе.
  const driver = view.carrier === undefined ? threadId : null;
  const waiting = driver === null ? undefined : view.stages.find((stage) => pendingStep(stage) !== null);
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
            <div data-progress-flow title={view.flowName} className="truncate px-3 pb-0.5 pt-1 text-[11px] text-muted-foreground">
              {view.flowName}
            </div>
          )}
          {view.stages.map((stage) => (
            <div key={stage.id} className="flex flex-col">
              <Row stage={stage} open={openResult} />
              {stage.automation !== undefined && stage.state !== "todo" && stage.state !== "skip" && <AutomationSteps stage={stage} threadId={driver} />}
            </div>
          ))}
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
