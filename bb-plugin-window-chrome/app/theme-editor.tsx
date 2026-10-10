// Window Chrome, фронт: форма темы окна — одна и та же в настройках плагина и в
// Side Pane треда. Цвета в два столбца «Светлая» и «Тёмная», числа в px, строка
// «Сохранить как тему» под полями. Каждая допустимая правка уходит на сервер, и
// оверлей темы сразу применяет её во всех окнах.
//
// Классы строк и кнопок — дословно из раздела настроек Connection
// (bb-plugin-connection/ui/guard-settings.tsx): плагин рисует классами сборки bb.
import { useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";

import {
  COLOR_GROUPS,
  effectiveDefault,
  inRange,
  isHex,
  NUMBER_GROUPS,
  withBackdrop,
  withColor,
  withNumber,
  type ColorId,
  type Mode,
  type NumberField,
  type ThemeValues,
} from "../core/theme";
import type { SaveResult, themeRpcContract } from "../shared/contract";
import { useThemeValues } from "./theme-style";

/** Пауза после последнего ввода, прежде чем значение уйдёт на сервер, мс. */
const WRITE_DELAY_MS = 150;
/** Пауза, прежде чем перечитать подсказки после смены темы bb, мс. */
const HINTS_DELAY_MS = 100;
/** Фон за островом без темы окна. */
const BACKDROP_DEFAULT = "#000000";

const ROW = "flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm";
const LABEL = "min-w-40 flex-1";
const CELLS = "flex shrink-0 gap-3";
const CELL = "flex w-40 shrink-0 items-center gap-1.5";
const GROUP = "pt-4 pb-1 text-xs text-muted-foreground";
const SECTION = "mt-3 border-t border-border/70 pt-3";
const BUTTON = "h-7 rounded-md border border-border/70 px-2 text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY = "h-7 rounded-md border border-transparent bg-foreground px-2 text-xs text-background disabled:cursor-not-allowed disabled:opacity-50";
const FIELD = "h-7 min-w-0 rounded-md border bg-transparent px-2 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring";
const fieldClass = (invalid: boolean): string => `${FIELD} ${invalid ? "border-destructive" : "border-input"}`;

type Canvas = CanvasRenderingContext2D;

/** Цвет CSS в hex: canvas переводит oklch и color-mix в sRGB. */
function toHex(context: Canvas, color: string): string | null {
  if (color === "") return null;
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

type Hints = Readonly<Record<Mode, Partial<Record<ColorId, string>>>>;

/**
 * Цвета текущей темы bb для пустых полей. Тема bb объявляет палитры на `:root, .light`
 * и `.dark`, поэтому пробник с классом режима получает палитру этого режима, а
 * живая таблица темы окна, привязанная к `:root`, его не задевает. Без canvas подсказок нет.
 */
function readHints(): Hints {
  const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const palette = (mode: Mode) => {
    if (!context) return {};
    const probe = document.createElement("div");
    probe.className = mode;
    probe.hidden = true;
    document.body.append(probe);
    const style = getComputedStyle(probe);
    const entries = COLOR_GROUPS.flatMap((g) => g.items).flatMap(({ id }) => {
      const hex = toHex(context, style.getPropertyValue(`--${id}`).trim());
      return hex ? [[id, hex]] : [];
    });
    probe.remove();
    return Object.fromEntries(entries);
  };
  return { light: palette("light"), dark: palette("dark") };
}

const currentMode = (): Mode => (document.documentElement.classList.contains("dark") ? "dark" : "light");

/**
 * Подсказки и текущий режим, пока форма открыта: bb меняет тему классом на <html>
 * и своими таблицами в <head> — после переключения или «Сохранить как тему»
 * подсказки читаются заново.
 */
function useThemeHints(): { hints: Hints; current: Mode } {
  const [state, setState] = useState(() => ({ hints: readHints(), current: currentMode() }));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Таблицы в <head> меняются пачками — и своя таблица темы на каждую правку: читаем раз после паузы.
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => setState({ hints: readHints(), current: currentMode() }), HINTS_DELAY_MS);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, []);
  return state;
}

export function ThemeEditor() {
  const saved = useThemeValues();
  const rpc = useRpc<typeof themeRpcContract>();
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const [draft, setDraft] = useState<ThemeValues | null>(null);
  const { hints, current } = useThemeHints();
  /** Правка, которая ждёт паузы во вводе. */
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; values: ThemeValues } | null>(null);
  /** Цепочка записей: идут по очереди, и сохранение темы ждёт последнюю. */
  const writes = useRef<Promise<void>>(Promise.resolve());
  /** Чем кончилась последняя запись: отказ не рвёт цепочку, но сохранение о нём узнаёт. */
  const failure = useRef<unknown>(null);

  const write = (values: ThemeValues) => {
    writes.current = writes.current.then(() => rpcRef.current.call("set", values)).then(
      () => void (failure.current = null),
      (error: unknown) => void (failure.current = error),
    );
    return writes.current;
  };
  /** Отправить ждущую правку сразу и дождаться всех записей; последняя не легла — отказ. */
  const flush = async () => {
    const next = pending.current;
    if (next !== null) {
      clearTimeout(next.timer);
      pending.current = null;
      void write(next.values);
    }
    await writes.current;
    if (failure.current !== null) throw failure.current;
  };
  const change = (values: ThemeValues) => {
    setDraft(values);
    if (pending.current) clearTimeout(pending.current.timer);
    const timer = setTimeout(() => {
      pending.current = null;
      void write(values);
    }, WRITE_DELAY_MS);
    pending.current = { timer, values };
  };

  // Значения с сервера — правка из другого окна; пока своя правка не ушла, верна она.
  useEffect(() => {
    if (saved !== null && pending.current === null) setDraft(saved);
  }, [saved]);
  // Форму закрыли посреди паузы — правка всё равно уходит.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => void flushRef.current().catch(() => undefined), []);

  if (draft === null) return null;

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-x-3 border-b border-border/70 pb-1 text-xs text-muted-foreground">
        <span className={LABEL}>Цвет · пустое поле — цвет текущей темы bb</span>
        <div className={CELLS}>
          {(["light", "dark"] as const).map((mode) => (
            <span key={mode} className={CELL}>
              {mode === "light" ? "Светлая" : "Тёмная"}
              {mode === current && <span className="text-foreground">· сейчас</span>}
            </span>
          ))}
        </div>
      </div>
      {COLOR_GROUPS.map((group) => (
        <section key={group.title} className="flex flex-col">
          <div className={GROUP}>{group.title}</div>
          {group.items.map((field) => (
            <div key={field.id} className={ROW}>
              <span className={LABEL}>{field.label}</span>
              <div className={CELLS}>
                {(["light", "dark"] as const).map((mode) => (
                  <ColorCell
                    key={mode}
                    label={`${field.label}, ${mode === "light" ? "светлая" : "тёмная"} тема`}
                    value={draft[mode]?.[field.id] ?? null}
                    hint={hints[mode][field.id] ?? null}
                    onChange={(hex) => change(withColor(draft, mode, field.id, hex))}
                  />
                ))}
              </div>
            </div>
          ))}
        </section>
      ))}
      <section className="flex flex-col">
        <div className={GROUP}>Окно</div>
        <div className={ROW}>
          <span className={LABEL}>
            Фон за островом
            <small className="block text-xs text-muted-foreground">Один на обе темы</small>
          </span>
          <div className={CELLS}>
            <ColorCell label="Фон за островом" value={draft.backdrop ?? null} hint={BACKDROP_DEFAULT} onChange={(hex) => change(withBackdrop(draft, hex))} />
            <span className="w-40 shrink-0" />
          </div>
        </div>
      </section>
      <div className={SECTION}>
        {NUMBER_GROUPS.map((group) => (
          <section key={group.title} className="flex flex-col">
            <div className={GROUP}>{group.title}</div>
            {group.items.map((field) => (
              <div key={field.id} className={ROW}>
                <span className={LABEL}>
                  {field.label}
                  {field.hint && <small className="block text-xs text-muted-foreground">{field.hint}</small>}
                </span>
                <div className={CELLS}>
                  <NumberCell field={field} value={draft[field.id] ?? null} fallback={effectiveDefault(draft, field)} onChange={(value) => change(withNumber(draft, field.id, value))} />
                  <span className="w-40 shrink-0" />
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>
      <SaveRow flush={flush} save={(name, replace) => rpcRef.current.call("saveTheme", { name, replace })} />
    </div>
  );
}

/** Образец и поле hex; `null` — цвет текущей темы, его образец и подсказка в поле. */
function ColorCell({ label, value, hint, onChange }: { label: string; value: string | null; hint: string | null; onChange(hex: string | null): void }) {
  const [text, setText] = useState(value ?? "");
  useEffect(() => setText(value ?? ""), [value]);
  const shown = value ?? hint ?? BACKDROP_DEFAULT;
  const type = (next: string) => {
    setText(next);
    if (next === "") onChange(null);
    else if (isHex(next)) onChange(next);
  };
  return (
    <span className={CELL}>
      <label className="relative size-5 shrink-0 cursor-pointer overflow-hidden rounded-sm border border-border/70" style={{ background: shown }} title={shown}>
        <input type="color" aria-label={`${label}: образец`} value={shown} onChange={(event) => onChange(event.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
      </label>
      <input
        aria-label={label}
        aria-invalid={text !== "" && !isHex(text)}
        value={text}
        placeholder={hint ?? ""}
        maxLength={7}
        spellCheck={false}
        onChange={(event) => type(event.target.value.trim())}
        className={`${fieldClass(text !== "" && !isHex(text))} w-full flex-1 font-mono lowercase`}
      />
      <button
        type="button"
        aria-label={`${label}: вернуть цвет темы`}
        title="Вернуть цвет темы"
        onClick={() => onChange(null)}
        className={`size-5 shrink-0 rounded-sm text-muted-foreground hover:bg-accent ${value === null ? "invisible" : ""}`}
      >
        ×
      </button>
    </span>
  );
}

/** Число в px в пределах поля; пустое — действующее значение подсказкой. */
function NumberCell({ field, value, fallback, onChange }: { field: NumberField; value: number | null; fallback: number; onChange(value: number | null): void }) {
  const [text, setText] = useState(value === null ? "" : String(value));
  useEffect(() => setText(value === null ? "" : String(value)), [value]);
  const invalid = text !== "" && !inRange(field, Number(text));
  const type = (next: string) => {
    setText(next);
    if (next === "") onChange(null);
    else if (inRange(field, Number(next))) onChange(Number(next));
  };
  return (
    <span className={CELL}>
      <input
        type="number"
        aria-label={field.label}
        aria-invalid={invalid}
        min={field.min}
        max={field.max}
        value={text}
        placeholder={String(fallback)}
        onChange={(event) => type(event.target.value)}
        className={`${fieldClass(invalid)} w-16 tabular-nums`}
      />
      <span className="text-xs text-muted-foreground">px</span>
    </span>
  );
}

type Note = { kind: "idle" } | { kind: "busy" } | { kind: "failed"; message: string } | SaveResult;

/** Строка «Сохранить как тему»: имя, кнопка и итог последнего нажатия. */
function SaveRow({ flush, save }: { flush(): Promise<void>; save(name: string, replace: boolean): Promise<SaveResult> }) {
  const [name, setName] = useState("");
  const [note, setNote] = useState<Note>({ kind: "idle" });
  const run = (replace: boolean) => {
    setNote({ kind: "busy" });
    flush()
      .then(() => save(name, replace))
      .then(setNote, (error: unknown) => setNote({ kind: "failed", message: error instanceof Error ? error.message : String(error) }));
  };
  const busy = "kind" in note && note.kind === "busy";
  return (
    <div className={`${SECTION} flex flex-wrap items-center gap-2 text-sm`}>
      <input aria-label="Название темы" placeholder="Название темы" value={name} onChange={(event) => setName(event.target.value)} className={`${fieldClass(false)} w-48`} />
      <button type="button" disabled={busy || name.trim() === ""} onClick={() => run(false)} className={PRIMARY}>
        Сохранить как тему
      </button>
      <SaveNote note={note} replace={() => run(true)} />
    </div>
  );
}

function SaveNote({ note, replace }: { note: Note; replace(): void }) {
  if ("kind" in note) {
    if (note.kind === "failed") return <span className="text-xs text-destructive">Не удалось сохранить тему: {note.message}</span>;
    return <span className="text-xs text-muted-foreground">Тема ляжет в папку тем bb и появится в Settings → Appearance.</span>;
  }
  switch (note.status) {
    case "saved":
      return <span className="text-xs text-success">Тема «{note.id}» сохранена и включена.</span>;
    case "exists":
      return (
        <span className="inline-flex items-center gap-2 text-xs">
          Тема «{note.id}» уже есть.
          <button type="button" onClick={replace} className={BUTTON}>
            Заменить
          </button>
        </span>
      );
    case "invalid_name":
      return <span className="text-xs text-destructive">Имя — латиница, цифры и дефис; имена встроенных тем bb заняты.</span>;
    case "write_failed":
      return <span className="text-xs text-destructive">Не удалось записать тему: {note.message}</span>;
  }
}
