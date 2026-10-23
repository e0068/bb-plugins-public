// Правило в сообщении: директива `::rule{id="…"}`. Как бриф Flow — без рамки: бирка мелко, текст правила полем
// на утопленной подложке (поправить можно до записи), под ним «зачем», «Куда» — чип памяти или навыка и имя
// файла, «Похожее уже есть» строками стык в стык, свёрнутое «что изменится» — у замены строки с минусом и с плюсом —
// и внизу «Не записывать» и «Записать».
// Решение принято — кнопок нет, вместо них строка исхода. Файл пишет сервер, виджет только просит.
import { useEffect, useRef, useState } from "react";
import { useRpc, type PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";

import { readRuleId } from "../core/directive";
import { editedRule, placeLabelOf, ruleDiff, skillNameOf } from "../core/rule";
import type { FileRoots } from "../core/result-link";
import { Button } from "../components/ui/button";
import { Icon } from "../components/ui/icon";
import { Textarea } from "../components/ui/textarea";
import type { Locale } from "../lib/i18n";
import { cn } from "../lib/utils";
import type { RuleKind, RuleRecord, rulesRpcContract } from "../shared/contract";
import { ResultAnchor } from "./cells";
import { Dashed } from "./command";
import { useFileRoots } from "./file-roots";
import { LocaleProvider } from "./locale";
import { useLocale, useMessages } from "./locale-context";
import { NoMath } from "./no-math";

type Loaded = { kind: "loading" } | { kind: "error" } | { kind: "not_found" } | { kind: "found"; rule: RuleRecord };

const KIND_ICON: Record<RuleKind, "Bookmark" | "Toolbox"> = { memory: "Bookmark", skill: "Toolbox" };

const groupTitle = "text-xs font-medium text-muted-foreground";

/** Высота поля правила по тексту: правило в одну-две фразы, длиннее шести строк поле прокручивается. */
const rowsOf = (text: string): number => Math.min(6, Math.max(1, Math.ceil(text.length / 72), text.split("\n").length));

function FileLink({ path, line, roots, className }: { path: string; line?: number | undefined; roots: FileRoots | null; className?: string }) {
  return (
    <ResultAnchor target={path} line={line ?? null} roots={roots} className={cn("break-all font-mono text-xs underline decoration-border underline-offset-2 hover:decoration-current", className)}>
      {placeLabelOf(path)}
      {line === undefined ? "" : `:${line}`}
    </ResultAnchor>
  );
}

function Where({ rule, roots }: { rule: RuleRecord; roots: FileRoots | null }) {
  const t = useMessages();
  const { kind, name, path } = rule.target;
  return (
    <div className="flex flex-col gap-1.5">
      <div className={groupTitle}>{t.rule.where}</div>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-state-active px-2 text-xs">
          <Icon name={KIND_ICON[kind]} className="size-3" />
          {kind === "memory" ? t.rule.memory : t.rule.skill(name ?? skillNameOf(path))}
        </span>
        <FileLink path={path} roots={roots} className="text-foreground" />
        <span className={cn("text-xs", rule.mode === "create" ? "text-success" : "text-muted-foreground")}>{{ create: t.rule.newFile, append: t.rule.append, replace: t.rule.replace }[rule.mode]}</span>
      </div>
    </div>
  );
}

function Similar({ rule, roots }: { rule: RuleRecord; roots: FileRoots | null }) {
  const t = useMessages();
  if (rule.similar.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className={groupTitle}>{t.rule.similar}</div>
      <div className="flex flex-col gap-px overflow-hidden rounded-lg">
        {rule.similar.map((place) => (
          <div key={`${place.path}:${place.line ?? 0}`} data-rule-similar className="flex gap-3 bg-surface-recessed-solid px-3 py-2.5">
            <Icon name={KIND_ICON[place.kind]} className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <FileLink path={place.path} line={place.line} roots={roots} className="text-sm text-foreground" />
                <span className={cn("ml-auto text-xs", place.same === true ? "text-destructive" : "text-muted-foreground")}>{place.note}</span>
              </div>
              <div className="break-words text-sm leading-relaxed text-muted-foreground">{place.quote}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Diff({ rule, text }: { rule: RuleRecord; text: string }) {
  const t = useMessages();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <Button type="button" variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="h-auto w-fit gap-1 px-0 py-0.5 text-muted-foreground hover:bg-transparent">
        {open ? t.rule.hideDiff : t.rule.showDiff}
        <Icon name="ChevronDown" className={cn("size-3 transition-transform", open && "rotate-180")} />
      </Button>
      {open &&
        ruleDiff({ ...rule, ...editedRule(rule, text) }).map((file) => (
          <div key={file.path} data-rule-diff className="overflow-hidden rounded-lg bg-surface-recessed-solid">
            <div className="flex gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
              <span className="font-mono">{placeLabelOf(file.path)}</span>
              <span>· {file.isNew ? t.rule.newFile : file.path !== rule.target.path ? t.rule.indexNote : rule.mode === "replace" ? t.rule.replaceNote : t.rule.endNote}</span>
            </div>
            <pre className="whitespace-pre-wrap break-words py-1.5 font-mono text-xs leading-relaxed">
              {file.removed.map((line, i) => (
                <span key={`-${i}`} data-diff-removed className="block bg-destructive/10 px-3">
                  {`- ${line}`}
                </span>
              ))}
              {file.lines.map((line, i) => (
                <span key={`+${i}`} data-diff-added className="block bg-success/10 px-3">
                  {`+ ${line}`}
                </span>
              ))}
            </pre>
          </div>
        ))}
    </div>
  );
}

function Outcome({ rule, roots }: { rule: RuleRecord; roots: FileRoots | null }) {
  const t = useMessages();
  const decision = rule.decision;
  if (decision === undefined) return null;
  const line = "flex flex-wrap items-center gap-1.5 text-xs";
  if (decision.kind === "written")
    return (
      <div role="status" className={cn(line, "text-muted-foreground")}>
        <Icon name="CircleCheck" className="size-3.5 text-success" />
        <span>{t.rule.written}</span>
        {decision.paths.map((path) => (
          <span key={path} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true">·</span>
            <FileLink path={path} roots={roots} />
          </span>
        ))}
      </div>
    );
  if (decision.kind === "declined")
    return (
      <div role="status" className={cn(line, "text-muted-foreground")}>
        <Icon name="X" className="size-3.5" />
        <span>{t.rule.declined}</span>
      </div>
    );
  return (
    <div role="status" className={cn(line, "text-destructive")}>
      <Icon name="AlertCircle" className="size-3.5" />
      <span>{t.rule.conflict(placeLabelOf(decision.path))}</span>
    </div>
  );
}

type DecideRule = (input: { id: string; decision: "write" | "decline"; locale: Locale; text?: string }) => Promise<{ kind: "found"; rule: RuleRecord } | { kind: "not_found" }>;

/** Карточка правила; `decide` подменяет сервер — так её показывает пример на странице виджета, ничего не записывая. */
export function RuleCard({ initial, decide: send }: { initial: RuleRecord; decide?: DecideRule }) {
  const t = useMessages();
  const locale = useLocale();
  const rpc = useRpc<typeof rulesRpcContract>();
  const decideRule: DecideRule = send ?? ((input) => rpc.call("decideRule", input));
  const roots = useFileRoots(initial.threadId);
  const [rule, setRule] = useState(initial);
  const [text, setText] = useState(initial.decision?.kind === "written" ? initial.decision.text : initial.text);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const open = rule.decision === undefined;

  const decide = (decision: "write" | "decline") => {
    if (sending) return;
    setSending(true);
    setFailed(false);
    const edited = text.trim();
    void decideRule({ id: rule.id, decision, locale, ...(edited === "" || edited === rule.text ? {} : { text: edited }) })
      .then(
        (result) => (result.kind === "found" ? setRule(result.rule) : setFailed(true)),
        () => setFailed(true),
      )
      .finally(() => setSending(false));
  };

  return (
    <div role="group" aria-label={t.rule.group} aria-busy={sending || undefined} data-rule-card className="my-3 flex w-full flex-col gap-4">
      <div className="flex items-center gap-1.5 text-xs leading-none text-muted-foreground">
        <Icon name={KIND_ICON[rule.target.kind]} className="size-3" />
        <span>{rule.target.kind === "memory" ? t.rule.toMemory : t.rule.toSkill}</span>
      </div>
      <div className="rounded-lg bg-surface-recessed-solid px-3 py-2.5">
        {open ? (
          <Textarea
            aria-label={t.rule.textLabel}
            value={text}
            disabled={sending}
            rows={rowsOf(text)}
            onChange={(event) => setText(event.target.value)}
            className="min-h-0 resize-none rounded-none border-0 p-0 text-sm leading-relaxed focus-visible:ring-0"
          />
        ) : (
          <div className="break-words text-sm leading-relaxed">{text}</div>
        )}
        <div className="mt-1 break-words text-sm leading-relaxed text-muted-foreground">{rule.why}</div>
      </div>
      <Where rule={rule} roots={roots} />
      <Similar rule={rule} roots={roots} />
      <Diff rule={rule} text={open ? text.trim() || rule.text : text} />
      {open && (
        <div className="flex flex-wrap gap-px overflow-hidden rounded-lg">
          <Button type="button" variant="ghost" disabled={sending} onClick={() => decide("decline")} className="h-10 min-w-32 flex-1 rounded-none bg-surface-recessed-solid font-normal">
            {t.rule.decline}
          </Button>
          <Button type="button" disabled={sending} onClick={() => decide("write")} className="h-10 min-w-40 flex-1 gap-1.5 rounded-none font-semibold">
            <Icon name={sending ? "Spinner" : "Check"} className={cn("size-3.5", sending && "animate-spin")} />
            {sending ? t.rule.writing : t.rule.write}
          </Button>
        </div>
      )}
      {failed && (
        <span role="alert" className="text-xs text-destructive">
          {t.rule.failed}
        </span>
      )}
      <Outcome rule={rule} roots={roots} />
    </div>
  );
}

function RuleLoader({ id, source }: { id: string; source: string }) {
  const t = useMessages();
  const rpc = useRpc<typeof rulesRpcContract>();
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const [state, setState] = useState<Loaded>({ kind: "loading" });
  useEffect(() => {
    let live = true;
    rpcRef.current.call("getRule", { id }).then(
      (result) => live && setState(result.kind === "found" ? result : { kind: "not_found" }),
      () => live && setState({ kind: "error" }),
    );
    return () => void (live = false);
  }, [id]);
  switch (state.kind) {
    case "loading":
      return <div role="status" aria-label={t.rule.loading} aria-busy="true" className="my-3 h-24 animate-pulse rounded-lg bg-state-active" />;
    case "error":
      return <Dashed source={source}>{t.rule.loadFailed}</Dashed>;
    case "not_found":
      return <Dashed source={source}>{t.rule.notFound}</Dashed>;
    case "found":
      return <RuleCard initial={state.rule} />;
  }
}

function Rule({ attributes, source }: PluginMessageDirectiveProps) {
  const t = useMessages();
  const parsed = readRuleId(attributes);
  return parsed.kind === "ok" ? <RuleLoader id={parsed.id} source={source} /> : <Dashed source={source}>{t.rule.badId}</Dashed>;
}

export function RuleDirective(props: PluginMessageDirectiveProps) {
  return (
    <NoMath>
      <LocaleProvider>
        <Rule {...props} />
      </LocaleProvider>
    </NoMath>
  );
}
