// Список по `/` и `@` в полях Flow, как в композере треда: `/` — навыки и команды агента, `@` — файлы и папки рабочей
// копии. Список раскрывается под полем на месте, а не всплывает: карточка брифа обрезает всё, что выходит за её край,
// а на телефоне всплывашка спорит с клавиатурой. Фокус остаётся в поле — стрелки, Enter и Esc ведёт само поле.
import { useRpc } from "@get-bb/plugin-sdk/app";
import { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type SyntheticEvent } from "react";

import { Icon } from "../components/ui/icon";
import { overlayItem } from "../components/ui/field-overlay";
import { applyMention, mentionAt, rankByName, type MentionToken } from "../core/mentions";
import { SKILL_ICON } from "../lib/stage-icon-names";
import { cn } from "../lib/utils";
import type { MentionItem, mentionsRpcContract } from "../shared/contract";
import { useMessages } from "./locale-context";

type Ask = (word: Pick<MentionToken, "trigger" | "query">) => Promise<readonly MentionItem[]>;

/** Откуда полям брать список; вне провайдера — ниоткуда, поле работает без списка. */
const MentionSource = createContext<Ask | null>(null);

/** Источник списка полей внутри: с тредом — композер треда, без него — навыки каталога Flow. */
export function MentionsProvider({ threadId, children }: { threadId?: string; children: ReactNode }) {
  const rpc = useRpc<typeof mentionsRpcContract>();
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const ask = useMemo<Ask>(
    () => (word) =>
      rpcRef.current
        .call("mentions", { ...(threadId === undefined ? {} : { threadId }), trigger: word.trigger, query: word.query })
        .then((result) => (result.kind === "found" ? result.items : [])),
    [threadId],
  );
  return <MentionSource.Provider value={ask}>{children}</MentionSource.Provider>;
}

/** Пауза набора, после которой список файлов спрашивается заново: не по запросу на каждую букву. */
const DEBOUNCE_MS = 120;

/** Строк в списке не больше: дальше владелец сужает набором. */
const SHOWN = 30;

/** Сколько ждёт скрытие списка после ухода фокуса: тап по строке на телефоне уводит фокус раньше, чем доходит нажатие. */
const BLUR_HIDE_MS = 200;

/** Навык — тем же знаком, что в таблице этапов. */
const ICONS: Record<MentionItem["kind"], string> = { skill: SKILL_ICON, command: "Terminal", file: "Code", directory: "Folder" };

type FieldElement = HTMLTextAreaElement | HTMLInputElement;

/** Найденное по слову: ключ — что спросили, и ответ. */
type Found = { key: string; items: readonly MentionItem[] };

/**
 * Что спросить про слово. Навыков и команд немного: их список берётся один раз на слово, целиком, и сужается здесь же с
 * каждой буквой — без паузы и без устаревшего ответа. Файлов много, их ищет bb по набранному.
 */
const requestOf = (token: MentionToken) => (token.trigger === "/" ? { key: `/${token.start}`, query: "" } : { key: `@${token.query}`, query: token.query });

const contains = (item: MentionItem, query: string) => item.insert.toLowerCase().includes(query.toLowerCase());

/**
 * Строки списка для слова. Навыки — весь список агента, суженный по набранному. Файлы — ответ на это слово, а пока он в
 * пути — прежний ответ, суженный до путей с набранным: список не мигает на каждой букве и не предлагает лишнего.
 */
const shown = (token: MentionToken, found: Found): readonly MentionItem[] =>
  token.trigger === "/" ? rankByName(found.items, token.query, SHOWN) : found.key === requestOf(token).key ? found.items : found.items.filter((item) => contains(item, token.query));

/** Ответ на набранное слово: файлы спрашивает после паузы набора, а ответ на устаревшее слово отбрасывает. */
function useFound(token: MentionToken | null): readonly MentionItem[] {
  const ask = useContext(MentionSource);
  const [found, setFound] = useState<Found | null>(null);
  const request = token === null ? null : requestOf(token);
  const trigger = token?.trigger;
  const key = request?.key;
  const query = request?.query;
  useEffect(() => {
    if (ask === null || trigger === undefined || key === undefined || query === undefined) return;
    let alive = true;
    const timer = setTimeout(
      () =>
        void ask({ trigger, query }).then(
          (items) => alive && setFound({ key, items }),
          // Списка нет — поле работает как обычное: тост ради подсказки не нужен.
          () => alive && setFound({ key, items: [] }),
        ),
      trigger === "/" ? 0 : DEBOUNCE_MS,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [ask, trigger, key, query]);
  return found === null || token === null || found.key[0] !== token.trigger ? [] : shown(token, found);
}

/**
 * Список по `/` и `@` для одного поля. `field` склеивает свойства поля с теми, что нужны списку: курсор, уход фокуса и
 * клавиши — стрелки, Enter, Tab и Esc при открытом списке достаются ему, а не полю. `list` ставится под полем.
 */
export function useMentions(props: { value: string; onText: (text: string) => void; disabled?: boolean }) {
  const t = useMessages();
  const element = useRef<FieldElement | null>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const nextCaret = useRef<number | null>(null);
  const hide = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listId = useId();

  const word = caret === null || props.disabled === true ? null : mentionAt(props.value, caret);
  const token = word !== null && word.start !== dismissed ? word : null;
  const items = useFound(token);
  const open = items.length > 0;

  // Новое слово — выбор снова с первой строки, а закрытое Esc слово ушло — следующее снова открывает список.
  const tokenKey = token === null ? null : `${token.trigger}${token.start}:${token.query}`;
  useEffect(() => setActive(0), [tokenKey]);
  useEffect(() => {
    if (word === null || word.start !== dismissed) setDismissed(null);
  }, [word?.start, dismissed]);

  useEffect(() => () => clearTimeout(hide.current ?? undefined), []);

  /** Курсор за вставленным; фокус — обратно в поле, если тап по строке его увёл. */
  const placeCaret = (at: number) => {
    clearTimeout(hide.current ?? undefined);
    element.current?.focus();
    element.current?.setSelectionRange(at, at);
    setCaret(at);
  };

  // Выбор поменял текст — курсор встаёт за вставленным, когда поле уже с новым текстом.
  useLayoutEffect(() => {
    const at = nextCaret.current;
    if (at === null) return;
    nextCaret.current = null;
    placeCaret(at);
  }, [props.value]);

  const choose = (item: MentionItem) => {
    if (token === null) return;
    const next = applyMention(props.value, token, item.insert);
    // Выбрано уже набранное — текст тот же, и поле не перерисуется: курсор ставится сразу.
    if (next.text === props.value) return placeCaret(next.caret);
    nextCaret.current = next.caret;
    props.onText(next.text);
  };

  const onKeyDown = (event: KeyboardEvent<FieldElement>): boolean => {
    if (!open || token === null || event.nativeEvent.isComposing) return false;
    const step = (by: number) => () => setActive((i) => (i + by + items.length) % items.length);
    const pick = () => choose(items[Math.min(active, items.length - 1)]!);
    // Shift+Enter — перевод строки, как без списка.
    const keys: Partial<Record<string, () => void>> = { ArrowDown: step(1), ArrowUp: step(-1), Tab: pick, Escape: () => setDismissed(token.start), ...(event.shiftKey ? {} : { Enter: pick }) };
    const action = keys[event.key];
    if (action === undefined) return false;
    event.preventDefault();
    event.stopPropagation();
    action();
    return true;
  };

  const list = open ? (
    <div id={listId} role="listbox" aria-label={token?.trigger === "/" ? t.mentions.skills : t.mentions.files} className="max-h-60 overflow-auto rounded-lg border border-border bg-card p-1 shadow-sm">
      {items.map((item, i) => (
        <button
          key={`${item.kind}:${item.insert}`}
          id={`${listId}-${i}`}
          type="button"
          role="option"
          aria-selected={i === active}
          tabIndex={-1}
          // Нажатие мышью не уводит фокус из поля; тап может увести — тогда список ждёт его (`BLUR_HIDE_MS`), а выбор вернёт фокус.
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => setActive(i)}
          onClick={() => choose(item)}
          className={cn(overlayItem, "min-w-0 pointer-coarse:min-h-11", i === active && "bg-state-hover")}
        >
          <Icon name={ICONS[item.kind]} aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="shrink-0 font-medium">
            {token?.trigger}
            {item.name}
          </span>
          {item.description !== undefined && <span className="min-w-0 truncate text-muted-foreground">{item.description}</span>}
        </button>
      ))}
    </div>
  ) : null;

  /** Свойства поля поверх его собственных: ссылка и уход фокуса — обоим, клавиша — сначала списку, а взятая им до поля не доходит. */
  const field = <E extends FieldElement>(own: { ref?: (el: E | null) => void; onBlur?: () => void; onKeyDown?: (event: KeyboardEvent<E>) => void }) => ({
    ref: (el: E | null) => {
      element.current = el;
      own.ref?.(el);
    },
    onSelect: (event: SyntheticEvent<E>) => {
      clearTimeout(hide.current ?? undefined);
      setCaret(event.currentTarget.selectionStart);
    },
    onBlur: () => {
      hide.current = setTimeout(() => setCaret(null), BLUR_HIDE_MS);
      own.onBlur?.();
    },
    "aria-expanded": open,
    "aria-controls": open ? listId : undefined,
    "aria-activedescendant": open ? `${listId}-${Math.min(active, items.length - 1)}` : undefined,
    onKeyDown: (event: KeyboardEvent<E>) => {
      if (!onKeyDown(event)) own.onKeyDown?.(event);
    },
  });

  return { field, list };
}
