// Голосовой ввод в полях брифа: всё, что не трогает ни браузер, ни сеть. Куда
// встаёт распознанный текст, что уходит распознавателю подсказкой, умеет ли
// браузер писать звук и какими словами об этом сказать. Правила повторяют
// композер bb: файл `recording.<тип>`, пробелы схлопнуты, подсказка — текст
// перед курсором.

import type { Locale } from "../lib/i18n";
import { messages, type Messages } from "../lib/messages";

export type Selection = { start: number; end: number };

/** Запись короче секунды композер bb тоже не распознаёт. */
export const VOICE_MIN_MS = 1_000;
/** Дольше — запись останавливается и уходит на распознавание сама: звук идёт через RPC одним куском. */
export const VOICE_MAX_MS = 5 * 60_000;
export const VOICE_PROMPT_CHARS = 1_000;

export type UnsupportedReason = "insecure-origin" | "no-recorder";
export type VoiceSupport = { kind: "supported" } | { kind: "unsupported"; reason: UnsupportedReason };

export const VOICE_FAILURES = ["denied", "no-microphone", "recording-failed", "too-short", "no-audio", "empty", "unavailable"] as const;
export type VoiceFailure = (typeof VOICE_FAILURES)[number];

const UNSUPPORTED_KEY = { "insecure-origin": "insecureOrigin", "no-recorder": "noRecorder" } as const satisfies Record<UnsupportedReason, keyof Messages["voice"]>;

const FAILURE_KEY = {
  denied: "denied",
  "no-microphone": "noMicrophone",
  "recording-failed": "recordingFailed",
  "too-short": "tooShort",
  "no-audio": "noAudio",
  empty: "empty",
  unavailable: "unavailable",
} as const satisfies Record<VoiceFailure, keyof Messages["voice"]>;

/** Слова голосового ввода на языке интерфейса. */
export const voiceTexts = (locale?: Locale) => ({
  unsupported: (reason: UnsupportedReason): string => messages(locale).voice[UNSUPPORTED_KEY[reason]],
  failure: (failure: VoiceFailure): string => messages(locale).voice[FAILURE_KEY[failure]],
});

export const unsupportedText = voiceTexts().unsupported;
export const failureText = voiceTexts().failure;

/** Без HTTPS браузер прячет и getUserMedia, поэтому небезопасный адрес — причина первой. */
export const voiceSupport = (env: { isSecureContext: boolean; hasGetUserMedia: boolean; hasMediaRecorder: boolean }): VoiceSupport =>
  !env.isSecureContext
    ? { kind: "unsupported", reason: "insecure-origin" }
    : env.hasGetUserMedia && env.hasMediaRecorder
      ? { kind: "supported" }
      : { kind: "unsupported", reason: "no-recorder" };

export const normalizeTranscript = (raw: string): string => raw.replace(/\s+/g, " ").trim();

/** Текст перед курсором — контекст распознавателю; пустой не передаётся. */
export const promptBefore = (value: string, selection: Selection): string | undefined => {
  const before = value.slice(0, selection.start).trim().slice(-VOICE_PROMPT_CHARS);
  return before === "" ? undefined : before;
};

/** Выделение заменяется распознанным; с соседним текстом его разделяет ровно один пробел. */
export const insertTranscript = (value: string, selection: Selection, transcript: string): { value: string; caret: number } => {
  const before = value.slice(0, selection.start);
  const after = value.slice(selection.end);
  const head = before === "" || /\s$/.test(before) ? before : `${before} `;
  const tail = after === "" || /^\s/.test(after) ? after : ` ${after}`;
  return { value: `${head}${transcript}${tail}`, caret: head.length + transcript.length };
};

export const audioFileName = (mimeType: string): string =>
  `recording.${mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "mp4" : "webm"}`;

/** `btoa` принимает строку байтов; кусками, чтобы длинная запись не упёрлась в предел аргументов. */
export const bytesToBase64 = (bytes: Uint8Array): string => {
  const CHUNK = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) parts.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  return btoa(parts.join(""));
};
