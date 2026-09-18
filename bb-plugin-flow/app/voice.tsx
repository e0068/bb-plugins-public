// Голосовой ввод в полях брифа — как у композера bb. Провайдер держит одну
// запись на бриф: чья она, в какой фазе, и ошибку последней записи. Поле
// подключается хуком `useVoiceField`: он даёт кнопку микрофона, полосу записи
// на место поля и вставляет распознанный текст на место курсора.
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import type { z } from "zod";

import {
  VOICE_MAX_MS,
  bytesToBase64,
  insertTranscript,
  promptBefore,
  voiceTexts,
  type Selection,
  type VoiceFailure,
  type VoiceSupport,
} from "../core/voice";
import { Button } from "../components/ui/button";
import { Icon } from "../components/ui/icon";
import { cn } from "../lib/utils";
import type { voiceRpcContract } from "../shared/contract";
import { useLocale, useMessages } from "./locale-context";
import { browserVoiceSupport, startRecording, type Recording } from "./voice-recorder";

type TranscribeContract = (typeof voiceRpcContract)["transcribeVoice"];
export type Transcribe = (input: z.input<TranscribeContract["input"]>) => Promise<z.output<TranscribeContract["output"]>>;

type Phase = "recording" | "transcribing";

/**
 * Запись брифа. `owner` — экземпляр хука поля: номер пункта может уехать под
 * записью, экземпляр — нет. `field` — адрес поля для строки ошибки.
 */
type Session =
  | { kind: "idle" }
  | { kind: "acquiring"; owner: string; field: string }
  | { kind: Phase; owner: string; field: string; stream: MediaStream };

type VoiceError = { field: string; text: string };

type Voice = {
  support: VoiceSupport;
  session: Session;
  error: VoiceError | null;
  start: (owner: string, field: string, prompt: string | undefined, onText: (text: string) => void) => void;
  confirm: () => void;
  /** Отменяет запись этого хозяина; чужую не трогает. */
  cancel: (owner: string) => void;
  clearError: (field: string) => void;
};

const VoiceContext = createContext<Voice | null>(null);

const IDLE: Session = { kind: "idle" };

type Live = { recording: Recording; prompt: string | undefined; onText: (text: string) => void };

export function VoiceProvider({ transcribe, children }: { transcribe: Transcribe; children: ReactNode }) {
  const locale = useLocale();
  const [support] = useState(browserVoiceSupport);
  const [session, setSession] = useState<Session>(IDLE);
  const [error, setError] = useState<VoiceError | null>(null);
  // Зеркало состояния для обработчиков, которые переживают рендер; пишется только через `put`.
  const current = useRef<Session>(IDLE);
  // Номер попытки: итог отменённой или перезапущенной записи до поля не доходит.
  const attempt = useRef(0);
  const live = useRef<Live | null>(null);
  const limit = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const transcribeRef = useRef(transcribe);
  transcribeRef.current = transcribe;

  const put = useCallback((next: Session) => {
    current.current = next;
    setSession(next);
  }, []);

  const finish = useCallback(
    (failure?: { field: string; failure: VoiceFailure }) => {
      clearTimeout(limit.current);
      live.current = null;
      put(IDLE);
      if (failure !== undefined) setError({ field: failure.field, text: voiceTexts(locale).failure(failure.failure) });
    },
    [put, locale],
  );

  const confirm = useCallback(async () => {
    const at = current.current;
    const recorded = live.current;
    if (at.kind !== "recording" || recorded === null) return;
    const mine = attempt.current;
    clearTimeout(limit.current);
    put({ ...at, kind: "transcribing" });
    const audio = await recorded.recording.finish();
    if (mine !== attempt.current) return;
    if (audio.kind === "failed") return finish({ field: at.field, failure: audio.failure });
    let result: Awaited<ReturnType<Transcribe>>;
    try {
      const base64 = bytesToBase64(new Uint8Array(await audio.blob.arrayBuffer()));
      result = await transcribeRef.current({ audio: base64, mimeType: audio.mimeType, ...(recorded.prompt === undefined ? {} : { prompt: recorded.prompt }) });
    } catch {
      result = { kind: "failed", reason: "unavailable" };
    }
    if (mine !== attempt.current) return;
    if (result.kind === "failed") return finish({ field: at.field, failure: result.reason });
    finish();
    recorded.onText(result.text);
  }, [finish, put]);

  const start = useCallback(
    async (owner: string, field: string, prompt: string | undefined, onText: (text: string) => void) => {
      if (current.current.kind !== "idle" || support.kind !== "supported") return;
      const mine = ++attempt.current;
      setError(null);
      put({ kind: "acquiring", owner, field });
      const started = await startRecording((failure) => {
        if (mine === attempt.current) finish({ field, failure });
      }).catch(() => ({ kind: "failed" as const, failure: "recording-failed" as const }));
      if (mine !== attempt.current) {
        if (started.kind === "started") started.recording.cancel();
        return;
      }
      if (started.kind === "failed") return finish({ field, failure: started.failure });
      live.current = { recording: started.recording, prompt, onText };
      put({ kind: "recording", owner, field, stream: started.recording.stream });
      limit.current = setTimeout(() => void confirm(), VOICE_MAX_MS);
    },
    [confirm, finish, put, support.kind],
  );

  const cancel = useCallback(
    (owner: string) => {
      const at = current.current;
      if (at.kind === "idle" || at.owner !== owner) return;
      attempt.current += 1;
      live.current?.recording.cancel();
      finish();
    },
    [finish],
  );

  const clearError = useCallback((field: string) => setError((e) => (e?.field === field ? null : e)), []);

  // Бриф ушёл из ленты посреди записи — микрофон освобождается.
  useEffect(
    () => () => {
      attempt.current += 1;
      clearTimeout(limit.current);
      live.current?.recording.cancel();
    },
    [],
  );

  const value = useMemo<Voice>(
    () => ({ support, session, error, start: (o, f, p, t) => void start(o, f, p, t), confirm: () => void confirm(), cancel, clearError }),
    [support, session, error, start, confirm, cancel, clearError],
  );
  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

/** Идёт ли в брифе запись: пока идёт, строки, под которыми съехали бы номера полей, не убираются. */
export const useVoiceBusy = (): boolean => (useContext(VoiceContext)?.session.kind ?? "idle") !== "idle";

type FieldElement = HTMLTextAreaElement | HTMLInputElement;

/**
 * Голосовой ввод одного поля. `id` — адрес поля в брифе; ошибку показывает
 * `VoiceErrorLine` с областью, в которую `id` входит (`own:q` входит в `own`).
 * Без провайдера и при `id === null` микрофона нет. Поле ушло или сменило адрес
 * посреди записи, или его текст поменялся не голосом, — запись отменяется.
 * `onIdle` зовётся, когда запись этого поля закончилась без вставки текста.
 */
export function useVoiceField(props: { id: string | null; label: string; value: string; disabled: boolean; onChange: (text: string) => void; onIdle?: () => void }) {
  const t = useMessages();
  const locale = useLocale();
  const voice = useContext(VoiceContext);
  const owner = useId();
  const element = useRef<FieldElement | null>(null);
  const value = useRef(props.value);
  value.current = props.value;
  const onChange = useRef(props.onChange);
  onChange.current = props.onChange;
  const onIdle = useRef(props.onIdle);
  onIdle.current = props.onIdle;
  const cancel = useRef(voice?.cancel);
  cancel.current = voice?.cancel;
  const caret = useRef<number | null>(null);

  const enabled = voice !== null && props.id !== null;
  const session = voice?.session ?? IDLE;
  const mine = enabled && session.kind !== "idle" && session.owner === owner;
  const phase: Phase | null = mine && session.kind !== "acquiring" ? session.kind : null;
  const active = mine ? session.kind : "idle";

  useEffect(() => () => cancel.current?.(owner), [owner, props.id]);

  // Текст, с которым запись началась: другой текст под полосой значит, что поле съехало.
  const startValue = useRef<string | null>(null);
  useEffect(() => {
    if (active === "idle") startValue.current = null;
    else if (startValue.current === null) startValue.current = props.value;
    else if (startValue.current !== props.value) cancel.current?.(owner);
  }, [active, owner, props.value]);

  const wasActive = useRef(false);
  useLayoutEffect(() => {
    const el = element.current;
    if (active !== "idle") {
      wasActive.current = true;
      return;
    }
    if (!wasActive.current) return;
    wasActive.current = false;
    if (caret.current === null) {
      onIdle.current?.();
      return;
    }
    // Поле вернулось на место полосы с распознанным текстом — курсор встаёт сразу за ним.
    if (el !== null) {
      el.focus();
      el.setSelectionRange(caret.current, caret.current);
    }
    caret.current = null;
  }, [active, props.value]);

  const change = (text: string) => {
    if (enabled) voice.clearError(props.id!);
    onChange.current(text);
  };

  const begin = () => {
    if (!enabled) return;
    const el = element.current;
    const text = value.current;
    const selection: Selection =
      el !== null && document.activeElement === el
        ? { start: el.selectionStart ?? text.length, end: el.selectionEnd ?? text.length }
        : { start: text.length, end: text.length };
    voice.start(owner, props.id!, promptBefore(text, selection), (transcript) => {
      const next = insertTranscript(value.current, selection, transcript);
      caret.current = next.caret;
      startValue.current = null;
      change(next.value);
    });
  };

  const reason = !enabled
    ? undefined
    : voice.support.kind === "unsupported"
      ? voiceTexts(locale).unsupported(voice.support.reason)
      : session.kind !== "idle" && !mine
        ? t.voice.busyElsewhere
        : undefined;

  return {
    phase,
    ref: (el: FieldElement | null) => {
      element.current = el;
    },
    onChange: (event: ChangeEvent<FieldElement>) => change(event.target.value),
    mic: enabled ? (
      <button
        type="button"
        aria-label={t.voice.input(props.label)}
        title={reason ?? t.voice.inputTitle}
        disabled={props.disabled || reason !== undefined || active === "acquiring"}
        // Фокус и выделение остаются в поле: по ним понятно, куда вставлять текст.
        onPointerDown={(event) => event.preventDefault()}
        onClick={begin}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
      >
        <Icon name="Mic" className="size-3.5" />
      </button>
    ) : null,
    strip:
      phase !== null && session.kind !== "idle" && session.kind !== "acquiring" ? (
        <RecordingStrip phase={phase} stream={session.stream} onCancel={() => voice?.cancel(owner)} onConfirm={() => voice?.confirm()} />
      ) : null,
  };
}

/** Ошибка записи или распознавания для полей области `scope` — красной строкой под ними. */
export function VoiceErrorLine({ scope, className }: { scope: string; className?: string }) {
  const error = useContext(VoiceContext)?.error;
  if (error == null || !(error.field === scope || error.field.startsWith(`${scope}:`))) return null;
  return (
    <span role="alert" className={cn("block break-words text-xs text-destructive", className)}>
      {error.text}
    </span>
  );
}

// ——— полоса записи ———

function RecordingStrip({ phase, stream, onCancel, onConfirm }: { phase: Phase; stream: MediaStream; onCancel: () => void; onConfirm: () => void }) {
  const transcribing = phase === "transcribing";
  const t = useMessages();
  const round = "size-8 shrink-0 rounded-full p-0 [&_svg]:size-4";
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 py-0.5">
      <Button type="button" variant="ghost" size="icon" aria-label={transcribing ? t.voice.cancelTranscribe : t.voice.cancelRecording} onClick={onCancel} className={round}>
        <Icon name="X" />
      </Button>
      <div className={cn("relative h-7 min-w-0 flex-1", transcribing && "animate-pulse")}>
        <Waveform stream={stream} active={!transcribing} />
        <span className="sr-only" aria-live="polite">
          {transcribing ? t.voice.transcribing : t.voice.recording}
        </span>
      </div>
      <Button type="button" variant="default" size="icon" aria-label={transcribing ? t.voice.transcribing : t.voice.stopAndTranscribe} disabled={transcribing} onClick={onConfirm} className={round}>
        {transcribing ? <Icon name="Spinner" className="animate-spin" /> : <Icon name="Check" />}
      </Button>
    </div>
  );
}

// Параметры волны композера bb: столбик 3 px, шаг 5 px, отсчёт через кадр,
// порог и усиление громкости, левые 15% тают.
const BAR = 3;
const STEP = BAR + 2;
const IDLE_LEVEL = 0.06;

const levelOf = (samples: Uint8Array): number => {
  let sum = 0;
  for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
  return Math.min(1, (Math.max(0, Math.sqrt(sum / samples.length) - 0.006) * 8) ** 0.6);
};

function Waveform({ stream, active }: { stream: MediaStream; active: boolean }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const levels = useRef<number[]>([]);

  useEffect(() => {
    const el = canvas.current;
    // Без Web Audio (jsdom, старые браузеры) полоса остаётся пустой: запись идёт и так.
    if (el === null || typeof AudioContext !== "function") return;
    const ctx = el.getContext("2d");
    if (ctx === null) return;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const { clientWidth: w, clientHeight: h } = el;
      if (el.width !== Math.round(w * dpr)) el.width = Math.round(w * dpr);
      if (el.height !== Math.round(h * dpr)) el.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.max(1, Math.floor(w / STEP));
      if (levels.current.length === 0) levels.current = Array.from({ length: count }, () => IDLE_LEVEL);
      if (levels.current.length > count) levels.current = levels.current.slice(-count);
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = getComputedStyle(el).color;
      ctx.lineCap = "round";
      ctx.lineWidth = BAR;
      const mid = h / 2;
      const amplitude = Math.max(0, (h * 0.95 - BAR) / 2);
      const fade = w * 0.15;
      levels.current.forEach((_, t) => {
        const x = w - BAR / 2 - t * STEP;
        const level = levels.current[levels.current.length - 1 - t]!;
        ctx.globalAlpha = x < fade ? Math.max(0.15, x / fade) : 1;
        ctx.beginPath();
        ctx.moveTo(x, mid - level * amplitude);
        ctx.lineTo(x, mid + level * amplitude);
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
      return count;
    };

    const track = stream.getAudioTracks()[0];
    if (!active || track === undefined) {
      draw();
      return;
    }
    const audio = new AudioContext();
    const source = audio.createMediaStreamSource(new MediaStream([track.clone()]));
    const analyser = audio.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    let frame = 0;
    let raf = 0;
    const tick = () => {
      if (frame % 2 === 0) {
        analyser.getByteTimeDomainData(samples);
        levels.current.push(levelOf(samples));
        const count = draw();
        if (levels.current.length > count) levels.current.shift();
      }
      frame += 1;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      source.mediaStream.getTracks().forEach((t) => t.stop());
      void audio.close();
    };
  }, [stream, active]);

  return <canvas ref={canvas} aria-hidden="true" className="block h-full w-full text-foreground" />;
}
