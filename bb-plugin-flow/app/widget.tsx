// Бриф в сообщении агента: директива `::decision{id="…"}`. Черновик ответа
// живёт здесь, запись и реплика агенту — на бэкенде через RPC. Из контракта
// берутся только типы: значения SDK в бандл фронта не попадают.
import { useCallback, useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { useRealtime, useRpc, type PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";

import { deviations } from "../core/answer-message";
import { readDecisionId } from "../core/directive";
import { DEFAULT_ROUTE, legacyRoute, offeredPlace } from "../core/places";
import { isLegacyBrief } from "../core/rows";
import { Button } from "../components/ui/button";
import { Icon } from "../components/ui/icon";
import { Input } from "../components/ui/input";
import { cn } from "../lib/utils";
import type {
  AnswerRecord,
  DecisionBrief,
  DecisionOption,
  DecisionQuestion,
  QuestionAnswer,
  decisionsRpcContract,
  dispatchRpcContract,
  DispatchPlace,
  DispatchRoute,
  voiceRpcContract,
} from "../shared/contract";
import {
  acceptRecommendations,
  decidedCount,
  pickOption,
  setNote,
  setOwn,
  settleDispatch,
  toAnswer,
  type Draft,
} from "./draft";
import { attachmentsPayload, clearAttachments } from "./attachments";
import { AnsweredBriefCard, BriefCard, ClarifyCard, useDispatchPicker } from "./brief-card";
import { clearStoredDraft } from "./draft-storage";
import { Frame, NoteField, RecommendedStar, Titles, answeredAt, useStoredDraft, useSubmit, type FormProps } from "./parts";
import { LocaleProvider } from "./locale";
import { ProviderLogosProvider } from "./provider-logos-source";
import { useLocale, useMessages } from "./locale-context";
import { useOpenFile } from "./open-file";
import { VoiceErrorLine, VoiceProvider, useVoiceField } from "./voice";

/** Канал `ANSWERED_CHANNEL` бэкенда; строкой, потому что `app` не берёт значений из `server`. */
const ANSWERED_CHANNEL = "decisions:answered";

type Loaded =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "not_found" }
  | { kind: "found"; brief: DecisionBrief; answer: AnswerRecord | null };

type Rpc = ReturnType<typeof useRpc<typeof decisionsRpcContract>>;

const isAbout = (payload: unknown, id: string): boolean =>
  typeof payload === "object" && payload !== null && (payload as { id?: unknown }).id === id;

function useBrief(id: string) {
  const rpc = useRpc<typeof decisionsRpcContract>();
  const rpcRef = useRef<Rpc>(rpc);
  rpcRef.current = rpc;
  const [state, setState] = useState<Loaded>({ kind: "loading" });

  const load = useCallback(async () => {
    try {
      const result = await rpcRef.current.call("getBrief", { id });
      setState(result.kind === "found" ? result : { kind: "not_found" });
    } catch {
      setState({ kind: "error" });
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtime(ANSWERED_CHANNEL, (payload) => {
    if (isAbout(payload, id)) void load();
  });

  const retry = () => {
    setState({ kind: "loading" });
    void load();
  };
  const answered = (record: AnswerRecord) =>
    setState((current) => (current.kind === "found" ? { ...current, answer: record } : current));
  return { state, retry, answered, rpcRef };
}

export function DecisionDirective(props: PluginMessageDirectiveProps) {
  return (
    <LocaleProvider>
      <ProviderLogosProvider>
        <Directive {...props} />
      </ProviderLogosProvider>
    </LocaleProvider>
  );
}

function Directive({ attributes, source, message, openWorkspaceFile }: PluginMessageDirectiveProps) {
  const t = useMessages();
  const parsed = readDecisionId(attributes);
  return parsed.kind === "ok" ? (
    <BriefLoader id={parsed.id} source={source} messageId={message.id} threadId={message.threadId} openWorkspaceFile={openWorkspaceFile} />
  ) : (
    <Dashed source={source}>{t.legacy.badId}</Dashed>
  );
}

/** Место исполнения по проекту треда: виджет открывается на последнем выборе владельца, сбой RPC — на «в этом треде». */
function useDispatchPlace(threadId: string): { place: DispatchPlace; route: DispatchRoute } {
  const rpc = useRpc<typeof dispatchRpcContract>();
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const [place, setPlace] = useState<{ place: DispatchPlace; route: DispatchRoute }>({ place: "here", route: DEFAULT_ROUTE });
  useEffect(() => {
    let alive = true;
    void rpcRef.current
      .call("getDispatchPlace", { threadId })
      .then((result) => {
        // Маршрута нет — место записано до трёх списков: старый новый worktree встаёт новым деревом.
        if (alive) setPlace({ place: offeredPlace(result.place), route: result.route ?? legacyRoute(result.place) });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [threadId]);
  return place;
}

function BriefLoader({ id, source, messageId, threadId, openWorkspaceFile }: { id: string; source: string; messageId: string; threadId: string; openWorkspaceFile: PluginMessageDirectiveProps["openWorkspaceFile"] }) {
  const t = useMessages();
  const place = useDispatchPlace(threadId);
  const locale = useLocale();
  const openFile = useOpenFile(threadId, openWorkspaceFile);
  const { state, retry, answered, rpcRef } = useBrief(id);
  const voiceRpc = useRpc<typeof voiceRpcContract>();
  const isAnswered = state.kind === "found" && state.answer !== null;
  useEffect(() => {
    // Отвеченному брифу черновик не нужен — отсюда ли ушёл ответ или из другой вкладки.
    if (isAnswered) clearStoredDraft(id);
  }, [id, isAnswered]);
  switch (state.kind) {
    case "loading":
      return <BriefSkeleton />;
    case "error":
      return (
        <div className="my-3 flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
          <Icon name="AlertCircle" className="size-4" />
          <span>{t.legacy.loadFailed}</span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={retry}>
            {t.legacy.retry}
          </Button>
        </div>
      );
    case "not_found":
      return <Dashed source={source}>{t.legacy.notFound}</Dashed>;
    case "found": {
      const legacy = isLegacyBrief(state.brief);
      if (state.answer !== null)
        return legacy ? (
          <AnsweredBrief brief={state.brief} record={state.answer} />
        ) : (
          <AnsweredBriefCard brief={state.brief} record={state.answer} openFile={openFile} />
        );
      const send = async (draft: Draft) =>
        rpcRef.current.call("answerBrief", { id, answer: toAnswer(state.brief, draft), messageId, locale, ...attachmentsPayload(id) });
      const onAccepted = (result: Awaited<ReturnType<typeof send>>) => {
        if (result.kind === "accepted" || result.kind === "already_answered") clearAttachments(id);
        if (result.kind === "accepted" || result.kind === "already_answered") answered(result.record);
        if (result.kind === "not_found") retry();
      };
      return (
        <VoiceProvider transcribe={(input) => voiceRpc.call("transcribeVoice", input)}>
          {state.brief.kind === "clarify" ? (
            <ClarifyCard brief={state.brief} send={send} onResult={onAccepted} />
          ) : legacy ? (
            <BriefForm brief={state.brief} send={send} onResult={onAccepted} place={place.place} route={place.route} />
          ) : (
            <BriefCard brief={state.brief} send={send} onResult={onAccepted} openFile={openFile} place={place.place} route={place.route} />
          )}
        </VoiceProvider>
      );
    }
  }
}

// ——— рамки и состояния ———

function Dashed({ source, children }: { source: string; children: ReactNode }) {
  return (
    <div className="my-3 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border bg-surface-recessed-solid px-3 py-2.5 text-sm text-muted-foreground">
      <Icon name="AlertCircle" className="size-4" />
      <span className="break-all font-mono text-xs">{source}</span>
      <span>{children}</span>
    </div>
  );
}

/** Скелетон и есть загрузка: восемь ячеек в форме блока брифа светлеют и темнеют со сдвигом фазы. */
const SKELETON_ROWS: ReadonlyArray<{ cells: number; height: string; className?: string }> = [
  { cells: 4, height: "h-11", className: "grid-cols-2 @[34rem]:grid-cols-4" },
  { cells: 1, height: "h-11" },
  { cells: 1, height: "h-10" },
  { cells: 2, height: "h-10", className: "grid-cols-2" },
];

/** Номер первой ячейки каждой строки скелетона — от него сдвиг фазы. */
const SKELETON_OFFSETS = SKELETON_ROWS.map((_, r) => SKELETON_ROWS.slice(0, r).reduce((sum, row) => sum + row.cells, 0));

function BriefSkeleton() {
  const t = useMessages();
  return (
    <div role="group" aria-label={t.legacy.loading} aria-busy="true" className="@container my-3 flex flex-col gap-px overflow-hidden rounded-lg">
      {SKELETON_ROWS.map((row, r) => (
        <div key={r} className={cn("grid gap-px", row.className)}>
          {Array.from({ length: row.cells }, (_, c) => {
            const i = SKELETON_OFFSETS[r]! + c;
            return <div key={i} data-skeleton-cell className={cn(row.height, "animate-pulse bg-state-active")} style={{ animationDelay: `${i * 150}ms` }} />;
          })}
        </div>
      ))}
    </div>
  );
}

// ——— мелкие части контролов ———

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-primary/45 px-1.5 text-[10.5px] font-semibold leading-snug text-primary">
      ✦ {children}
    </span>
  );
}

function Box({ on, round }: { on: boolean; round?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "mt-0.5 inline-flex size-3.5 shrink-0 items-center justify-center border-[1.5px] border-border",
        round ? "rounded-full" : "rounded",
        on && "border-primary text-primary",
      )}
    >
      {on && (round ? <span className="block size-[7px] rounded-full bg-current" /> : <Icon name="Check" className="size-2.5" />)}
    </span>
  );
}

const onClasses = "border-primary/60 bg-primary/10";

type QuestionProps = {
  question: DecisionQuestion;
  draft: Draft;
  locked: boolean;
  onPick: (optionId: string) => void;
  onOwn: (text: string) => void;
};

const entryOf = (draft: Draft, question: DecisionQuestion) => draft.entries[question.id];

/** Однострочное поле прежнего брифа с микрофоном у правого края; на время записи — полоса в той же рамке. */
function VoiceInput(props: Omit<ComponentProps<typeof Input>, "value" | "onChange" | "ref"> & { voiceId: string; label: string; value: string; disabled: boolean; onText: (text: string) => void; wrapperClassName: string }) {
  const { voiceId, label, value, disabled, onText, wrapperClassName, className, ...rest } = props;
  const voice = useVoiceField({ id: voiceId, label, value, disabled, onChange: onText });
  return voice.phase !== null ? (
    <div className={cn("flex min-w-56 items-center rounded-md border border-input px-0.5", wrapperClassName)}>{voice.strip}</div>
  ) : (
    <div className={cn("relative", wrapperClassName)}>
      <Input {...rest} ref={voice.ref} aria-label={label} value={value} disabled={disabled} onChange={voice.onChange} className={cn(className, "pr-8")} />
      <span className="absolute inset-y-0 right-0 flex items-center">{voice.mic}</span>
    </div>
  );
}

function Toggles({ question, draft, locked, onPick }: QuestionProps) {
  const chosen = entryOf(draft, question)?.optionIds ?? [];
  return (
    <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
      {question.options.map((option) => {
        const on = chosen.includes(option.id);
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={on}
            disabled={locked}
            onClick={() => onPick(option.id)}
            className={cn(
              "inline-flex min-w-fit flex-1 basis-0 items-center gap-1.5 rounded-lg border border-border bg-surface-recessed-solid py-1 pl-1.5 pr-2 text-left text-xs hover:bg-state-hover disabled:cursor-default",
              on && onClasses,
            )}
          >
            <Box on={on} />
            <span className="flex-1 break-words">{option.action}</span>
            {option.recommended && <RecommendedStar />}
          </button>
        );
      })}
    </div>
  );
}

function Segments({ question, draft, locked, onPick, onOwn }: QuestionProps) {
  const t = useMessages();
  const entry = entryOf(draft, question);
  const takesOwn = question.allowOwn || question.kind === "yesno";
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <div className="flex min-w-0 flex-1 overflow-hidden rounded-lg border border-border bg-surface-recessed-solid">
        {question.options.map((option) => {
          const on = entry?.optionIds.includes(option.id) ?? false;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={on}
              disabled={locked}
              onClick={() => onPick(option.id)}
              className={cn(
                "inline-flex flex-1 items-center justify-center gap-1 break-words border-r border-border px-2.5 py-1 text-center text-xs last:border-r-0 hover:bg-state-hover disabled:cursor-default",
                on && "bg-primary/15 font-semibold ring-1 ring-inset ring-primary/45",
              )}
            >
              {option.action}
              {option.recommended && <RecommendedStar />}
            </button>
          );
        })}
      </div>
      {takesOwn && (
        <VoiceInput
          voiceId={`own:${question.id}`}
          label={t.legacy.ownValue}
          placeholder={t.legacy.ownPlaceholder}
          value={entry?.own ?? ""}
          disabled={locked}
          onText={onOwn}
          wrapperClassName="w-34 shrink-0"
          className="h-7 w-full text-xs"
        />
      )}
    </div>
  );
}

function CompactRow(props: QuestionProps & { missing: boolean }) {
  const t = useMessages();
  const { question } = props;
  return (
    <div
      role="group"
      aria-label={question.question}
      className="grid grid-cols-1 items-center gap-x-2.5 gap-y-1 py-0.5 @[34rem]:grid-cols-[8.5rem_minmax(0,1fr)]"
    >
      <div className="min-w-0 break-words text-xs text-muted-foreground">
        <span className="block text-[13px] font-semibold text-foreground">{question.question}</span>
        {question.context}
        {props.missing && <span className="block text-destructive">{t.common.needAnswer}</span>}
      </div>
      {question.kind === "toggles" ? <Toggles {...props} /> : <Segments {...props} />}
      <VoiceErrorLine scope={`own:${question.id}`} className="col-span-full" />
    </div>
  );
}

function OptionMeta({ option }: { option: DecisionOption }) {
  const t = useMessages();
  return (
    <>
      {option.description !== undefined && (
        <span className="mt-0.5 block break-words text-xs leading-relaxed">{option.description}</span>
      )}
      {(option.cost !== undefined || option.risks !== undefined) && (
        <span className="mt-1 block break-words text-[11.5px] text-muted-foreground">
          <b className="font-semibold text-foreground/70">{t.legacy.price}</b> {option.cost}
          <span className="px-1 opacity-50">·</span>
          <b className="font-semibold text-foreground/70">{t.legacy.risks}</b> {option.risks}
        </span>
      )}
    </>
  );
}

function ForkSection(props: QuestionProps & { index: number; missing: boolean }) {
  const { question, draft, locked, onPick, onOwn } = props;
  const entry = entryOf(draft, question);
  const own = entry?.own ?? "";
  const t = useMessages();
  const voice = useVoiceField({ id: `own:${question.id}`, label: t.legacy.answerOwn, value: own, disabled: locked, onChange: onOwn });
  return (
    <div role="group" aria-label={question.question} className="border-t border-border/60 px-3 py-2.5 first:border-t-0">
      <div className="flex items-baseline gap-2">
        <span className="w-4 shrink-0 text-xs tabular-nums text-muted-foreground">{props.index}</span>
        <span className="min-w-0 break-words text-[13.5px] font-medium leading-snug">{question.question}</span>
        <span className={cn("ml-auto shrink-0 text-[11px]", props.missing ? "text-destructive" : "text-muted-foreground")}>
          {props.missing ? t.common.needAnswer : t.legacy.oneAnswer}
        </span>
      </div>
      {question.context !== undefined && (
        <div className="mb-1.5 ml-[22px] break-words text-[11.5px] text-muted-foreground">{question.context}</div>
      )}
      <div className="mt-1 flex flex-col gap-1 pl-[22px]">
        {question.options.map((option) => {
          const on = entry?.optionIds.includes(option.id) ?? false;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={on}
              disabled={locked}
              onClick={() => onPick(option.id)}
              className={cn(
                "flex w-full gap-2 rounded-lg border border-border bg-surface-recessed-solid px-2.5 py-2 text-left hover:bg-state-hover disabled:cursor-default",
                on && "border-primary/55 bg-primary/10",
              )}
            >
              <Box on={on} round />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="break-words text-[13px] font-semibold">{option.action}</span>
                  {option.recommended && <Pill>{t.legacy.recommend}</Pill>}
                </span>
                <OptionMeta option={option} />
              </span>
            </button>
          );
        })}
        <label
          className={cn(
            "flex w-full cursor-text items-center gap-2 rounded-lg border border-border bg-surface-recessed-solid px-2 py-1",
            own.trim() !== "" && onClasses,
          )}
        >
          <Box on={own.trim() !== ""} round />
          {voice.phase !== null ? (
            voice.strip
          ) : (
            <>
              <input
                ref={voice.ref}
                aria-label={t.legacy.answerOwn}
                placeholder={t.legacy.answerOwn}
                value={own}
                disabled={locked}
                onChange={voice.onChange}
                className="h-[22px] min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground"
              />
              {voice.mic}
            </>
          )}
        </label>
        <VoiceErrorLine scope={`own:${question.id}`} />
      </div>
    </div>
  );
}

// ——— формы брифа прежнего вида ———

function BriefForm({ brief, send, onResult, place, route }: FormProps & { place: DispatchPlace; route: DispatchRoute }) {
  const t = useMessages();
  const [draft, setDraft] = useStoredDraft(brief.id);
  const { sending, failed, missing, touch, submit } = useSubmit({ send, onResult });
  const { decided, total } = decidedCount(brief, draft);
  const complete = decided === total;
  const single = brief.questions.length === 1;
  const counter = t.common.decided(decided, total);
  const compact = brief.questions.filter((q) => q.kind !== "fork");
  const forks = brief.questions.filter((q) => q.kind === "fork");

  const questionProps = (question: DecisionQuestion): QuestionProps & { missing: boolean } => ({
    question,
    draft,
    locked: sending,
    // Неполноту называет сервер; пометка держится, пока владелец не тронет вопрос.
    missing: missing.has(question.id),
    onPick: (optionId) => {
      touch(question.id);
      setDraft((d) => pickOption(d, question, optionId));
    },
    onOwn: (text) => {
      touch(question.id);
      setDraft((d) => setOwn(d, question, text));
    },
  });

  const trySubmit = () => {
    if (complete && !sending) void submit(settleDispatch(draft, place, route));
  };
  const picker = useDispatchPicker({ draft, setDraft, place, route, disabled: sending, joined: true });

  return (
    <Frame
      label={brief.title}
      icon="ListTodo"
      heading={single && forks.length === 1 ? t.legacy.fork : t.legacy.brief}
      aside={counter}
      busy={sending}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          trySubmit();
        }
      }}
    >
      <Titles brief={brief} />
      {compact.length > 0 && (
        <div className="px-3 pb-2">
          {compact.map((question) => (
            <CompactRow key={question.id} {...questionProps(question)} />
          ))}
        </div>
      )}
      {compact.length > 0 && forks.length > 0 && (
        <div className="border-y border-border/60 bg-surface-recessed-solid px-3 py-1.5 text-xs font-semibold text-muted-foreground">
          {t.legacy.forksHeader}
        </div>
      )}
      {forks.map((question, i) => (
        <ForkSection key={question.id} index={i + 1} {...questionProps(question)} />
      ))}
      <div className="border-t border-border/60 bg-surface-recessed-solid p-2">
        {!single && (
          <>
            <NoteField
              value={draft.note}
              disabled={sending}
              onChange={(text) => setDraft((d) => setNote(d, text))}
              className="max-h-36 min-h-9 resize-none bg-card text-sm [field-sizing:content]"
              stripClassName="min-h-9 rounded-md border border-input bg-card px-1"
            />
            <VoiceErrorLine scope="note" className="mt-1" />
          </>
        )}
        <div className={cn("flex flex-wrap items-center gap-2", !single && "mt-2")}>
          <Button variant="outline" size="sm" disabled={sending} onClick={() => setDraft((d) => acceptRecommendations(brief, d))}>
            {single ? t.common.acceptRecommendation : t.common.acceptRecommendations}
          </Button>
          <span className="text-xs text-muted-foreground">{failed ? t.common.sendFailed : counter}</span>
          <div className="ml-auto flex min-w-40 overflow-hidden rounded-md">{picker.cell}</div>
          <Button variant="outline" size="sm" aria-label={single ? undefined : t.common.sendBrief} className="font-semibold" disabled={!complete || sending} onClick={trySubmit}>
            {sending && <Icon name="Spinner" className="size-3.5 animate-spin" />}
            {t.common.send}
          </Button>
        </div>
        {picker.lists !== null && <div className="mt-2">{picker.lists}</div>}
      </div>
    </Frame>
  );
}

// ——— отвечено ———

function OwnAnswer({ text }: { text: string }) {
  return (
    <span className={cn("flex w-full min-w-0 items-center gap-2 rounded-lg border px-2 py-1 text-[12.5px]", onClasses)}>
      <Box on round />
      <span className="min-w-0 break-words">{text}</span>
    </span>
  );
}

function LockedCompact({ question, entry }: { question: DecisionQuestion; entry: QuestionAnswer | undefined }) {
  const t = useMessages();
  const own = (entry?.own ?? "").trim() === "" ? null : (entry?.own ?? "");
  const chosen = entry?.optionIds ?? [];
  return (
    <div className="grid grid-cols-1 items-center gap-x-2.5 gap-y-1 py-0.5 @[34rem]:grid-cols-[8.5rem_minmax(0,1fr)]">
      <span className="min-w-0 break-words text-[13px] font-semibold">{question.question}</span>
      {own !== null ? (
        <OwnAnswer text={own} />
      ) : entry === undefined ? (
        <span className="text-xs text-muted-foreground">{t.legacy.noAnswer}</span>
      ) : question.kind === "toggles" ? (
        <span className="flex flex-wrap gap-1.5">
          {question.options.map((option) => {
            const on = chosen.includes(option.id);
            return (
              <span
                key={option.id}
                className={cn(
                  "inline-flex min-w-fit flex-1 basis-0 items-center gap-1.5 rounded-lg border border-border bg-surface-recessed-solid py-1 pl-1.5 pr-2 text-xs",
                  on ? onClasses : "opacity-55",
                )}
              >
                <Box on={on} />
                <span className="flex-1 break-words">{option.action}</span>
                {option.recommended && <RecommendedStar />}
              </span>
            );
          })}
        </span>
      ) : (
        <span className="flex overflow-hidden rounded-lg border border-border bg-surface-recessed-solid">
          {question.options.map((option) => (
            <span
              key={option.id}
              className={cn(
                "flex-1 break-words border-r border-border px-2.5 py-1 text-center text-xs last:border-r-0",
                chosen.includes(option.id) ? "bg-primary/15 font-semibold" : "opacity-55",
              )}
            >
              {option.action}
              {option.recommended && <RecommendedStar />}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

function LockedFork({ question, entry, index }: { question: DecisionQuestion; entry: QuestionAnswer | undefined; index: number }) {
  const t = useMessages();
  const own = (entry?.own ?? "").trim() === "" ? null : (entry?.own ?? "");
  return (
    <div className="border-t border-border/60 px-3 py-2.5 first:border-t-0">
      <div className="flex items-baseline gap-2">
        <span className="w-4 shrink-0 text-xs tabular-nums text-muted-foreground">{index}</span>
        <span className="min-w-0 break-words text-[13.5px] font-medium leading-snug">{question.question}</span>
      </div>
      <div className="mt-1 flex flex-col gap-1 pl-[22px]">
        {question.options.map((option) => {
          const on = entry?.optionIds.includes(option.id) ?? false;
          return (
            <div
              key={option.id}
              className={cn(
                "flex w-full gap-2 rounded-lg border border-border bg-surface-recessed-solid px-2.5 py-2",
                on ? "border-primary/55 bg-primary/10" : "opacity-55",
              )}
            >
              <Box on={on} round />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="break-words text-[13px] font-semibold">{option.action}</span>
                  {option.recommended && <Pill>{t.legacy.recommended}</Pill>}
                </span>
                {on && <OptionMeta option={option} />}
              </span>
            </div>
          );
        })}
        {own !== null && <OwnAnswer text={own} />}
      </div>
    </div>
  );
}

function AnsweredBrief({ brief, record }: { brief: DecisionBrief; record: AnswerRecord }) {
  const t = useMessages();
  const entry = (question: DecisionQuestion) => record.answer.answers.find((a) => a.questionId === question.id);
  const compact = brief.questions.filter((q) => q.kind !== "fork");
  const forks = brief.questions.filter((q) => q.kind === "fork");
  const clarify = brief.kind === "clarify";
  return (
    <Frame
      label={brief.title}
      icon="CircleCheck"
      heading={clarify ? t.common.clarifyAnswered : t.common.briefAnswered}
      aside={answeredAt(record.answeredAt, t.common.dateLocale)}
    >
      <Titles brief={brief} subtitle={t.common.deviations(deviations(brief, record.answer), brief.questions.length)} />
      {compact.length > 0 && (
        <div className="px-3 pb-2">
          {compact.map((question) => (
            <LockedCompact key={question.id} question={question} entry={entry(question)} />
          ))}
        </div>
      )}
      {compact.length > 0 && forks.length > 0 && (
        <div className="border-y border-border/60 bg-surface-recessed-solid px-3 py-1.5 text-xs font-semibold text-muted-foreground">
          {t.legacy.forks}
        </div>
      )}
      {forks.map((question, i) => (
        <LockedFork key={question.id} index={i + 1} question={question} entry={entry(question)} />
      ))}
      {(record.answer.note ?? "").trim() !== "" && (
        <div className="break-words border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
          <b className="font-semibold text-foreground">{t.common.noteToBrief}</b> {record.answer.note}
        </div>
      )}
    </Frame>
  );
}
