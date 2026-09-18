// Слой 4 — оболочка UI: слежение за набором и запись в скрытый слот.
//
// Набор виден только фронту, поэтому писать в слот может лишь поверхность,
// живущая в композере. Пишется он по паузе в наборе, а не на каждый символ:
// быстрый набор иначе дал бы десятки записей в секунду. Опустевший композер —
// это отправка или очистка, и слот гасится сразу, без ожидания паузы.
//
// Провал записи молчит: слот — подстраховка на случай вылета, а не отправка,
// и тост на каждую неудачную паузу был бы шумом поверх и без того потерянного.
import { useEffect, useRef } from "react";
import { useComposerView, useSettings } from "@get-bb/plugin-sdk/app";
import { isBlank } from "../core/drafts";
import { parseSettings } from "../core/settings";
import type { Where } from "../core/place";
import { useDraftActions } from "./use-drafts";

/** Пауза в наборе, после которой набранное уходит в слот. */
const PAUSE_MS = 400;
/** Потолок: при безостановочном наборе слот пишется не реже, чем раз в это время. */
const CEILING_MS = 2000;

/** Область не наша — `where` равен `null`, и слежение не ведётся. */
export function useAutosave(where: Where | null): void {
  const { autosave } = parseSettings(useSettings().values);
  const text = useComposerView().draft.text;
  const actions = useDraftActions();

  const send = useRef(actions.autosave);
  send.current = actions.autosave;
  /** Последний отправленный текст; `null` — не отправляли ещё ничего. */
  const sent = useRef<string | null>(null);
  const sentAt = useRef(Date.now());
  const target = useRef(where);
  target.current = where;

  // Композер в зависимостях строкой: смена области отменяет отложенную запись,
  // иначе таймер, заведённый в одном треде, выстрелил бы уже в другом и унёс
  // туда чужой текст. Объект `where` для этого не годится — он новый на каждый
  // рендер и перезаводил бы таймер, так что пауза не наступала бы никогда.
  const composerId = where === null ? null : "threadId" in where ? `thread:${where.threadId}` : `home:${where.projectId}`;
  const known = useRef(composerId);

  useEffect(() => {
    const composer = target.current;
    if (!autosave || composer === null) return;
    if (known.current !== composerId) {
      known.current = composerId;
      sent.current = null;
      sentAt.current = Date.now();
    }
    // Композер открылся пустым — гасить нечего, слот этого композера пуст.
    if (sent.current === null && isBlank(text)) {
      sent.current = text;
      return;
    }
    if (text === sent.current) return;

    const flush = () => {
      sent.current = text;
      sentAt.current = Date.now();
      void send.current(composer, text).catch(() => undefined);
    };
    if (isBlank(text)) {
      flush();
      return;
    }
    const wait = Math.max(0, Math.min(PAUSE_MS, CEILING_MS - (Date.now() - sentAt.current)));
    const timer = setTimeout(flush, wait);
    return () => clearTimeout(timer);
  }, [autosave, text, composerId]);
}
