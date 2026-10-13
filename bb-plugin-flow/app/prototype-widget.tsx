// Виджет «Прототип» под карточкой Демонстрации. Над окном — карточка шириной колонки: развилки, которые прислала страница
// прототипа, строками сегментов, и комментарии агенту строками. Окно — во всю ширину диалога: строка адреса с кнопками и
// сама страница. Связь со страницей — только сообщениями окна (протокол — ../lib/prototype-protocol.ts), разбор — в ядре
// (../core/prototype.ts). Выбор и комментарии виджет пишет на сервер: они переживают перезагрузку и уходят агенту с
// ответом на утверждение. Собран из готовых компонентов — своих стилей тут нет, сторож ../style-guard.test.ts это держит.
import { useRpc } from "@get-bb/plugin-sdk/app";
import { useEffect, useRef, useState } from "react";

import { Button } from "../components/ui/button";
import { FullBleed } from "../components/ui/full-bleed";
import { Icon } from "../components/ui/icon";
import { Input } from "../components/ui/input";
import {
  EMPTY_PROTOTYPE,
  PICK_MESSAGE,
  editOf,
  frameMessage,
  prototypeAddress,
  restoreMessage,
  setMessage,
  withChoice,
  withComment,
  withForks,
  withoutComment,
} from "../core/prototype";
import type { PrototypeState, prototypeRpcContract } from "../shared/contract";
import { AddRow } from "./add-row";
import { useMessages } from "./locale-context";
import { Frame } from "./parts";
import { Segmented } from "./segmented";

/** Комментарий агенту: ничего, ждём клика по месту в окне или пишем текст — с местом или без. */
type CommentMode = { kind: "idle" } | { kind: "picking" } | { kind: "writing"; at?: string };

/** Пауза перед записью на сервер: серия переключений уходит одной записью. */
const SAVE_DELAY_MS = 400;

const SANDBOX = "allow-scripts allow-same-origin allow-forms allow-popups allow-modals";

export function PrototypeWidget({ threadId, url, title }: { threadId: string; url: string; title?: string }) {
  const t = useMessages().prototype;
  const rpc = useRpc<typeof prototypeRpcContract>();
  const address = prototypeAddress(url);
  const frame = useRef<HTMLIFrameElement>(null);
  const [state, setState] = useState<PrototypeState | null>(null);
  const latest = useRef<PrototypeState>(EMPTY_PROTOTYPE);
  latest.current = state ?? EMPTY_PROTOTYPE;
  const [edited, setEdited] = useState(0);
  const [mode, setMode] = useState<CommentMode>({ kind: "idle" });
  const [draft, setDraft] = useState("");
  const [page, setPage] = useState(0);
  const [ready, setReady] = useState(false);

  const post = (message: object) => frame.current?.contentWindow?.postMessage(message, "*");
  const edit = (update: (state: PrototypeState) => PrototypeState) => {
    setState((current) => update(current ?? EMPTY_PROTOTYPE));
    setEdited((n) => n + 1);
  };

  // Память прототипа — при открытии; не прочиталась — виджет начинает с пустой.
  useEffect(() => {
    let alive = true;
    rpc
      .call("getPrototype", { threadId, url: address })
      .then(({ state: stored }) => alive && setState((current) => current ?? stored ?? EMPTY_PROTOTYPE))
      .catch(() => alive && setState((current) => current ?? EMPTY_PROTOTYPE));
    return () => {
      alive = false;
    };
  }, [rpc, threadId, address]);

  // Правка уходит на сервер с паузой. Развилки, присланные страницей, — тоже правка: их подписи нужны строкам ответа агенту.
  useEffect(() => {
    if (edited === 0) return;
    const timer = setTimeout(() => void rpc.call("savePrototype", { threadId, url: address, edit: editOf(latest.current) }).catch(() => undefined), SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [rpc, threadId, address, edited]);

  // Сообщения только своего окна и только по протоколу.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (frame.current === null || event.source !== frame.current.contentWindow) return;
      const message = frameMessage(event.data);
      if (message === null) return;
      switch (message.type) {
        case "ready": {
          // Окно открыто после чтения памяти, поэтому `latest` — уже прочитанное; странице уходит выбор только её развилок.
          const next = withForks(latest.current, message.forks);
          setReady(true);
          edit(() => next);
          post(restoreMessage(next.choices));
          return;
        }
        case "choice":
          edit((current) => withChoice(current, message.fork, message.value));
          return;
        case "picked":
          setMode({ kind: "writing", at: message.label });
          return;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const choose = (forkId: string, value: string) => {
    edit((current) => withChoice(current, forkId, value));
    post(setMessage(forkId, value));
  };
  const startComment = () => {
    if (mode.kind !== "idle") return setMode({ kind: "idle" });
    // Страница без протокола места не назовёт — сразу поле общего комментария.
    if (!ready) return setMode({ kind: "writing" });
    post(PICK_MESSAGE);
    setMode({ kind: "picking" });
  };
  const addComment = () => {
    const at = mode.kind === "writing" ? mode.at : undefined;
    edit((current) => withComment(current, { id: crypto.randomUUID(), text: draft.trim(), ...(at === undefined ? {} : { at }) }));
    setDraft("");
    setMode({ kind: "idle" });
  };

  const shown = state ?? EMPTY_PROTOTYPE;
  const touched = Object.keys(shown.choices).length;
  const hasCard = shown.forks.length > 0 || shown.comments.length > 0 || mode.kind !== "idle";

  return (
    <>
      {hasCard && (
        <Frame label={t.title} icon="Globe" heading={title ?? t.title} aside={shown.forks.length > 0 ? t.forksState(touched, shown.forks.length) : undefined}>
          <div className="flex flex-col gap-px">
            {shown.forks.map((fork) => (
              <div key={fork.id} className="flex min-h-9 flex-wrap items-center gap-x-3 bg-surface-recessed-solid px-3 py-1">
                <span className={touched > 0 && fork.id in shown.choices ? "w-44 shrink-0 text-sm" : "w-44 shrink-0 text-sm text-muted-foreground"}>{fork.label}</span>
                <Segmented
                  label={fork.label}
                  value={shown.choices[fork.id] ?? fork.options[0]!.value}
                  onChange={(value) => choose(fork.id, value)}
                  options={fork.options.map((option) => ({ value: option.value, label: option.label }))}
                />
              </div>
            ))}
            {shown.comments.map((comment) => (
              <div key={comment.id} className="flex min-h-9 items-center gap-2 bg-surface-recessed-solid pl-3 pr-1 text-sm">
                <Icon name="MessageSquare" className="size-3.5 shrink-0 text-muted-foreground" />
                {comment.at !== undefined && <span className="shrink-0 text-muted-foreground">{comment.at}</span>}
                <span className="min-w-0 flex-1 break-words">{comment.text}</span>
                {comment.sent === true ? (
                  <span className="shrink-0 pr-2 text-xs text-muted-foreground">{t.sent}</span>
                ) : (
                  <Button variant="ghost" size="icon" aria-label={t.remove} onClick={() => edit((current) => withoutComment(current, comment.id))}>
                    <Icon name="X" />
                  </Button>
                )}
              </div>
            ))}
            {mode.kind === "picking" && (
              <div className="flex min-h-9 items-center gap-2 bg-surface-recessed-solid pl-3 pr-1 text-sm text-muted-foreground">
                <Icon name="Target" className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1">{t.pick}</span>
                <Button variant="secondary" size="sm" onClick={() => setMode({ kind: "idle" })}>
                  {t.cancel}
                </Button>
              </div>
            )}
            {mode.kind === "writing" && (
              <>
                {mode.at !== undefined && (
                  <div className="flex items-center gap-2 bg-surface-recessed-solid px-3 pt-2 text-xs text-muted-foreground">
                    <Icon name="Target" className="size-3.5 shrink-0" />
                    {mode.at}
                  </div>
                )}
                <AddRow label={t.comment} placeholder={mode.at === undefined ? t.commentPlaceholder : t.commentAtPlaceholder} value={draft} onText={setDraft} onEnter={addComment} disabled={false} voiceId="prototype-comment" />
              </>
            )}
          </div>
        </Frame>
      )}
      <FullBleed>
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <div className="flex items-center gap-2 border-b border-border/70 bg-surface-recessed-solid px-2 py-1.5">
            <Button variant="ghost" size="icon" aria-label={t.reload} onClick={() => setPage((n) => n + 1)}>
              <Icon name="Refresh" />
            </Button>
            <Input readOnly value={url} aria-label={t.address} className="h-8 min-w-0 flex-1 text-xs" />
            <Button variant="secondary" size="sm" aria-pressed={mode.kind !== "idle"} onClick={startComment}>
              <Icon name="MessageSquare" />
              {t.comment}
              {shown.comments.length > 0 && <span className="font-semibold">{shown.comments.length}</span>}
            </Button>
            <Button variant="ghost" size="icon" asChild>
              <a href={url} target="_blank" rel="noreferrer" aria-label={t.fullScreen}>
                <Icon name="Maximize2" />
              </a>
            </Button>
          </div>
          {/* Окно — только после чтения памяти: страница, ответившая раньше сервера, получила бы пустой выбор и стёрла сохранённый. */}
          {state !== null && <iframe key={page} ref={frame} src={url} title={t.title} sandbox={SANDBOX} className="block h-120 w-full border-0 bg-background" />}
        </div>
      </FullBleed>
    </>
  );
}
