// Баннер прогресса flow над композером треда: шапкой композера — иконка
// текущего этапа, «N из M», сегменты этапов и план времени и бюджета; тап
// раскрывает над шапкой список этапов той же сеткой колонок. Опрос RPC раз в
// 5 секунд — прогресс пишут бриф, ответ, отметки агента и исполнитель
// автоматизаций. Этап, на котором идёт работа, приглушённо мерцает значком;
// поверх сегмента идущей или упавшей автоматизации — молния, под её строкой —
// шаги с повтором упавшего.
import { useEffect, useRef, useState } from "react";
import { useBbNavigate, useComposerView, useRpc } from "@get-bb/plugin-sdk/app";

import { mutedBlinkAnimation, mutedBlinkKeyframes } from "../core/muted-blink";
import { fileTarget, resultLink } from "../core/result-link";
import { stageLabel } from "../core/stages";
import { Icon } from "../components/ui/icon";
import { cn } from "../lib/utils";
import type { ProgressStage, ProgressView, automationRpcContract, filesRpcContract, progressRpcContract } from "../shared/contract";
import { LocaleProvider } from "./locale";
import { ProviderLogosProvider } from "./provider-logos-source";
import { ProviderMark } from "./provider-logos";
import { useMessages } from "./locale-context";
import { BUILTIN_AUTOMATION_ICON, KIND_ICONS } from "./stage-icons";

const POLL_MS = 5000;

/** Иконки исполнителя этапа навыка без логотипа провайдера: ромб — сам, агент, workflow. */
const EXECUTOR_ICONS = { self: "Diamond", agent: "Bot", workflow: "Workflow" } as const;

const iconOf = (stage: ProgressStage): string =>
  stage.automation !== undefined ? BUILTIN_AUTOMATION_ICON : stage.kind === "skill" ? EXECUTOR_ICONS[stage.executor] : KIND_ICONS[stage.kind];

/** У этапа навыка, который ведёт сам агент или субагент, — логотип провайдера исполнителя. */
const byProvider = (stage: ProgressStage): boolean => stage.automation === undefined && stage.kind === "skill" && stage.executor !== "workflow";

/** Приглушённое мерцание элемента, на этапе которого идёт работа; кадры кладёт полоса. */
const pulse = (live: boolean | undefined) => (live === true ? { "data-pulse": "", style: { animation: mutedBlinkAnimation } } : {});

/** Значок этапа: мерцает, пока на этапе идёт работа. */
function StageIcon({ stage, className }: { stage: ProgressStage; className?: string }) {
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

/** Строки шагов автоматизации под её этапом; у упавшего — ошибка, «Повторить» и «Пропустить» — когда эффект уже есть, например PR открыт руками. */
function AutomationSteps({ stage, threadId }: { stage: ProgressStage; threadId: string }) {
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
          <span className="flex min-w-0 items-baseline gap-2 pl-3">
            <span className={cn("shrink-0 whitespace-nowrap", step.state === "todo" && "text-muted-foreground", step.state === "fail" && "text-destructive")}>{label(step)}</span>
            {step.error !== null && (
              <span title={step.error} className="min-w-0 truncate text-muted-foreground">
                {step.error}
              </span>
            )}
          </span>
          {step.state === "fail" ? (
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

const money = (value: number): string => `$${Number.isInteger(value) ? value : value.toFixed(1)}`;

/** Колонки шапки и строк: иконка, середина, минуты и доллары вплотную, отметка. */
const COLUMNS = "grid grid-cols-[16px_minmax(0,1fr)_auto_20px] items-center gap-2.5";

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
  if (threadId === null || view === null || view.total === 0) return null;
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

function useOpenResult(threadId: string, environmentId: string | null) {
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

function Spent({ minutes, cost }: { minutes: number | null; cost: number | null }) {
  const t = useMessages();
  return (
    <span className="flex justify-end gap-1.5 whitespace-nowrap tabular-nums">
      {minutes !== null && <span className="min-w-8 text-right">{t.progress.minutes(minutes)}</span>}
      {cost !== null && <span className="min-w-10 text-right">{money(cost)}</span>}
    </span>
  );
}

function Row({ stage, open }: { stage: ProgressStage; open: (target: string) => void }) {
  const t = useMessages();
  const first = stage.results[0];
  const muted = stage.state === "todo" || stage.state === "skip";
  return (
    <div data-progress-row className={cn(COLUMNS, "min-h-7 px-3 py-1", (stage.state === "now" || stage.state === "fail") && "bg-state-active")}>
      <StageIcon stage={stage} className={muted ? "text-muted-foreground" : "text-foreground"} />
      <span className="flex min-w-0 items-baseline gap-2.5">
        <span className={cn("shrink-0 whitespace-nowrap", muted && "text-muted-foreground", stage.state === "skip" && "line-through")}>{stageLabel(stage, t.stages)}</span>
        {stage.state === "done" && first !== undefined ? (
          <>
            <button type="button" onClick={() => open(first.target)} className="min-w-0 truncate text-left underline decoration-foreground/35 underline-offset-2 hover:text-primary">
              {first.label}
            </button>
            {stage.results.length > 1 && <span className="shrink-0 text-[11px] text-muted-foreground">+{stage.results.length - 1}</span>}
          </>
        ) : (
          <span className="min-w-0 truncate text-[11px] text-muted-foreground">
            {stage.state === "fail"
              ? t.progress.failed
              : stage.state === "now"
                ? stage.automation !== undefined
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
      <Spent minutes={stage.state === "done" ? stage.minutes : null} cost={stage.state === "done" ? stage.cost : null} />
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

function Progress({ view, threadId, open, toggle }: { view: ProgressView; threadId: string; open: boolean; toggle: () => void }) {
  const t = useMessages();
  const openResult = useOpenResult(threadId, view.environmentId ?? null);
  const current = view.stages.find((s) => s.id === view.current) ?? view.stages[view.stages.length - 1]!;
  return (
    // bb кладёт баннеры в сетку с отступом mb-2 до композера: последний баннер съедает его и ещё пиксель рамки, чтобы стать шапкой композера.
    <div className="mx-2.5 -mb-px overflow-hidden last:-mb-[calc(0.5rem+1px)] rounded-t-[10px] border border-b-0 border-border bg-surface-recessed-solid text-xs">
      <style>{mutedBlinkKeyframes}</style>
      {open && (
        <div className="flex max-h-[50vh] flex-col gap-px overflow-y-auto pt-1">
          {view.flowName !== undefined && (
            <div data-progress-flow title={view.flowName} className="truncate px-3 pb-0.5 pt-1 text-[11px] text-muted-foreground">
              {view.flowName}
            </div>
          )}
          {view.stages.map((stage) => (
            <div key={stage.id} className="flex flex-col">
              <Row stage={stage} open={openResult} />
              {stage.automation !== undefined && stage.state !== "todo" && stage.state !== "skip" && <AutomationSteps stage={stage} threadId={threadId} />}
            </div>
          ))}
        </div>
      )}
      <button type="button" aria-expanded={open} aria-label={t.progress.label(stageLabel(current, t.stages), view.step, view.total)} onClick={toggle} className={cn(COLUMNS, "min-h-[34px] w-full px-3 py-1.5 text-left hover:bg-state-hover")}>
        <StageIcon stage={current} />
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="shrink-0 tabular-nums">{t.progress.count(view.step, view.total)}</span>
          <span aria-hidden="true" className="flex h-1 min-w-10 flex-1 gap-0.5">
            {view.stages.filter((stage) => stage.state !== "skip").map((stage) => (
              <i
                key={stage.id}
                data-progress-segment
                {...pulse(stage.automation === undefined && stage.live)}
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
                {stage.automation !== undefined && (stage.state === "now" || stage.state === "fail") && (
                  // Молния поверх сегмента с жирным контуром цвета фона полосы: отделяет значок от соседних сегментов.
                  <span
                    data-automation-mark
                    {...pulse(stage.live)}
                    className={cn(
                      "absolute left-1/2 top-1/2 flex size-3.5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-surface-recessed-solid ring-2 ring-surface-recessed-solid",
                      stage.state === "now" ? "text-foreground" : "text-destructive",
                    )}
                  >
                    <Icon name={BUILTIN_AUTOMATION_ICON} className="size-3" />
                  </span>
                )}
              </i>
            ))}
          </span>
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
    </div>
  );
}
