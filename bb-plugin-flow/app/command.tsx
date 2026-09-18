// Команда в сообщении: директива `::command{id="…"}`. Команда моноширинным
// шрифтом и справа три кнопки строкой, как у пункта критерия: перенос строк,
// копирование и ввод на контрастной подложке. Подложка одна, без полосы
// между кодом и кнопками; группа кнопок с отступом 6px, так что от ввода до
// правого, верхнего и нижнего края — поровну.
import { useEffect, useRef, useState } from "react";
import { useRpc, type PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";

import { readCommandId } from "../core/directive";
import { Icon } from "../components/ui/icon";
import { cn } from "../lib/utils";
import type { CommandRecord, commandsRpcContract } from "../shared/contract";
import { useFlash } from "./flash";
import { RESULT_ROW } from "./cells";
import { LocaleProvider } from "./locale";
import { useMessages } from "./locale-context";

type Loaded = { kind: "loading" } | { kind: "error" } | { kind: "not_found" } | { kind: "found"; command: CommandRecord };

/** Сколько держится галочка после копирования и после ввода, мс. */
const COPIED_MS = 1400;
const SENT_MS = 1600;

const iconButton = "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground disabled:cursor-default";

function Dashed({ source, children }: { source: string; children: string }) {
  return (
    <div className="my-3 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border bg-surface-recessed-solid px-3 py-2.5 text-sm text-muted-foreground">
      <Icon name="AlertCircle" className="size-4" />
      <span className="break-all font-mono text-xs">{source}</span>
      <span>{children}</span>
    </div>
  );
}

type Run = () => Promise<{ kind: "sent" | "not_found" }>;

/** Перенос, копирование и ввод команды с их исходом — общие у блока в сообщении и у строки результата Демонстрации. */
function useCommandActions(command: string, send: Run) {
  const t = useMessages();
  const [wrap, setWrap] = useState(false);
  const [copied, flashCopied] = useFlash(COPIED_MS);
  const [sent, flashSent] = useFlash(SENT_MS);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy = () => {
    setError(null);
    void navigator.clipboard.writeText(command).then(flashCopied, () => setError(t.command.copyFailed));
  };
  const run = () => {
    if (running) return;
    setRunning(true);
    setError(null);
    void send()
      .then(
        (result) => (result.kind === "sent" ? flashSent() : setError(t.command.notFound)),
        () => setError(t.command.sendFailed),
      )
      .finally(() => setRunning(false));
  };

  const buttons = (
    <>
      <button type="button" aria-label={t.command.wrap} title={t.command.wrap} aria-pressed={wrap} onClick={() => setWrap((w) => !w)} className={cn(iconButton, wrap && "bg-state-active text-foreground")}>
        <Icon name="TextWrap" className="size-3.5" />
      </button>
      <button type="button" aria-label={t.command.copy} title={copied ? t.command.copied : t.command.copy} onClick={copy} className={cn(iconButton, copied && "text-success")}>
        <Icon name={copied ? "Check" : "Copy"} className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label={t.command.run}
        title={sent ? t.command.sent : t.command.run}
        aria-busy={running || undefined}
        disabled={running}
        onClick={run}
        className="flex size-7 shrink-0 items-center justify-center rounded-md bg-foreground text-background hover:bg-foreground/90 disabled:cursor-default"
      >
        <Icon name={running ? "Spinner" : sent ? "Check" : "ArrowTurnBackward"} className={cn("size-3.5", running && "animate-spin")} />
      </button>
    </>
  );
  const status = sent ? t.command.sent : copied ? t.command.copied : "";
  return { wrap, buttons, status, error };
}

function CommandBlock({ command, run }: { command: string; run: Run }) {
  const t = useMessages();
  const { wrap, buttons, status, error } = useCommandActions(command, run);
  return (
    <div className="my-3 flex flex-col gap-1">
      <div role="group" aria-label={t.command.group} className="flex min-h-10 items-start rounded-lg bg-surface-recessed-solid">
        <pre className={cn("min-w-0 flex-1 py-2.5 pl-3 pr-2 font-mono text-[12.5px] leading-5", wrap ? "whitespace-pre-wrap break-words" : "overflow-x-auto whitespace-pre")}>{command}</pre>
        <div className="flex shrink-0 items-center gap-1 p-1.5">{buttons}</div>
      </div>
      {/* Живая строка: исход копирования и ввода слышен и без взгляда на иконку. */}
      <span role="status" aria-live="polite" className="min-h-4 text-xs text-muted-foreground">
        {status}
      </span>
      {error !== null && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}

/** Результат-команда Демонстрации — строкой среди результатов: без подписи (она — имя строки), команда моноширинным и три кнопки справа; ошибка — вместо команды, удача — галочкой на кнопке. */
export function CommandResultRow({ label, command, run, className }: { label: string; command: string; run: Run; className?: string }) {
  const t = useMessages();
  const { wrap, buttons, status, error } = useCommandActions(command, run);
  return (
    <div role="group" aria-label={label} data-result-row className={cn(RESULT_ROW, "items-start", className)}>
      <pre className={cn("min-w-0 flex-1 self-center py-1.5 font-mono text-[11px]", error !== null ? "text-destructive" : "text-muted-foreground", wrap ? "whitespace-pre-wrap break-words" : "truncate")}>
        {error ?? command}
      </pre>
      <span className="-mr-1.5 flex shrink-0 items-center gap-1 self-center">{buttons}</span>
      <span role="status" aria-live="polite" className="sr-only">
        {status}
      </span>
    </div>
  );
}

function CommandLoader({ id, source }: { id: string; source: string }) {
  const t = useMessages();
  const rpc = useRpc<typeof commandsRpcContract>();
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const [state, setState] = useState<Loaded>({ kind: "loading" });
  useEffect(() => {
    let live = true;
    rpcRef.current.call("getCommand", { id }).then(
      (result) => live && setState(result.kind === "found" ? result : { kind: "not_found" }),
      () => live && setState({ kind: "error" }),
    );
    return () => void (live = false);
  }, [id]);
  switch (state.kind) {
    case "loading":
      return <div role="status" aria-label={t.command.loading} aria-busy="true" className="my-3 h-10 animate-pulse rounded-lg bg-state-active" />;
    case "error":
      return <Dashed source={source}>{t.command.loadFailed}</Dashed>;
    case "not_found":
      return <Dashed source={source}>{t.command.notFoundShort}</Dashed>;
    case "found":
      return <CommandBlock command={state.command.command} run={() => rpc.call("runCommand", { id: state.command.id })} />;
  }
}

export function CommandDirective(props: PluginMessageDirectiveProps) {
  return (
    <LocaleProvider>
      <Command {...props} />
    </LocaleProvider>
  );
}

function Command({ attributes, source }: PluginMessageDirectiveProps) {
  const t = useMessages();
  const parsed = readCommandId(attributes);
  return parsed.kind === "ok" ? <CommandLoader id={parsed.id} source={source} /> : <Dashed source={source}>{t.command.badId}</Dashed>;
}
