// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  VOICE_FAILURES,
  VOICE_PROMPT_CHARS,
  audioFileName,
  bytesToBase64,
  failureText,
  insertTranscript,
  normalizeTranscript,
  promptBefore,
  unsupportedText,
  voiceSupport,
} from "./voice";

const selectionIn = (value: string) =>
  fc.tuple(fc.nat({ max: value.length }), fc.nat({ max: value.length })).map(([a, b]) => ({ start: Math.min(a, b), end: Math.max(a, b) }));

describe("распознанный текст встаёт на место курсора", () => {
  it("в пустое поле — ровно распознанный текст, курсор после него", () => {
    expect(insertTranscript("", { start: 0, end: 0 }, "Привет")).toEqual({ value: "Привет", caret: 6 });
  });

  it("слова не склеиваются с соседями ни слева, ни справа", () => {
    expect(insertTranscript("до после", { start: 2, end: 2 }, "между").value).toBe("до между после");
    expect(insertTranscript("начало", { start: 6, end: 6 }, "конец").value).toBe("начало конец");
    expect(insertTranscript("хвост", { start: 0, end: 0 }, "Голова").value).toBe("Голова хвост");
  });

  it("лишних пробелов не добавляет там, где пробел уже есть", () => {
    expect(insertTranscript("до ", { start: 3, end: 3 }, "после")).toEqual({ value: "до после", caret: 8 });
    expect(insertTranscript("до  после", { start: 3, end: 3 }, "между").value).toBe("до между после");
  });

  it("выделенный текст заменяется распознанным", () => {
    expect(insertTranscript("было старое слово", { start: 5, end: 11 }, "новое").value).toBe("было новое слово");
  });

  it("текст до курсора и после него сохраняется, курсор стоит сразу за вставкой", () => {
    fc.assert(
      fc.property(
        fc.string().chain((value) => fc.tuple(fc.constant(value), selectionIn(value))),
        fc.string({ minLength: 1 }).filter((s) => s.trim() === s && s !== ""),
        ([value, selection], transcript) => {
          const result = insertTranscript(value, selection, transcript);
          expect(result.value.startsWith(value.slice(0, selection.start))).toBe(true);
          expect(result.value.endsWith(value.slice(selection.end))).toBe(true);
          expect(result.value.slice(0, result.caret).endsWith(transcript)).toBe(true);
        },
      ),
    );
  });
});

describe("текст распознавания", () => {
  it("пробелы и переносы схлопываются в один пробел, края обрезаются", () => {
    expect(normalizeTranscript("  первая \n\n вторая\tтретья  ")).toBe("первая вторая третья");
  });

  it("подсказка распознавателю — текст перед курсором, не длиннее предела", () => {
    expect(promptBefore("до курсора|после", { start: 10, end: 10 })).toBe("до курсора");
    expect(promptBefore("   ", { start: 3, end: 3 })).toBeUndefined();
    const long = "а".repeat(VOICE_PROMPT_CHARS + 50);
    expect(promptBefore(long, { start: long.length, end: long.length })).toHaveLength(VOICE_PROMPT_CHARS);
  });

  it("файл называется по типу записи, как у композера", () => {
    expect(audioFileName("audio/webm;codecs=opus")).toBe("recording.webm");
    expect(audioFileName("audio/mp4")).toBe("recording.mp4");
    expect(audioFileName("audio/ogg;codecs=opus")).toBe("recording.ogg");
    expect(audioFileName("")).toBe("recording.webm");
  });

  it("base64 совпадает с кодировкой Node для любых байтов", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 100_000 }), (bytes) => {
        expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
      }),
      { numRuns: 50 },
    );
  });
});

describe("когда браузер умеет записывать звук", () => {
  const env = { isSecureContext: true, hasGetUserMedia: true, hasMediaRecorder: true };

  it("по HTTPS с MediaRecorder и доступом к микрофону — умеет", () => {
    expect(voiceSupport(env)).toEqual({ kind: "supported" });
  });

  it("не по HTTPS — не умеет, и причина в этом, даже если API нет", () => {
    expect(voiceSupport({ isSecureContext: false, hasGetUserMedia: false, hasMediaRecorder: false })).toEqual({ kind: "unsupported", reason: "insecure-origin" });
  });

  it("без MediaRecorder или без getUserMedia — не умеет", () => {
    expect(voiceSupport({ ...env, hasMediaRecorder: false })).toEqual({ kind: "unsupported", reason: "no-recorder" });
    expect(voiceSupport({ ...env, hasGetUserMedia: false })).toEqual({ kind: "unsupported", reason: "no-recorder" });
  });

  it("у каждой причины и каждой ошибки свой непустой текст", () => {
    const texts = [unsupportedText("insecure-origin"), unsupportedText("no-recorder"), ...VOICE_FAILURES.map(failureText)];
    expect(texts.every((t) => t.trim() !== "")).toBe(true);
    expect(new Set(texts).size).toBe(texts.length);
  });
});
