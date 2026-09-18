// Запись звука браузером — оболочка эффектов голосового ввода. Здесь и только
// здесь трогаются getUserMedia и MediaRecorder; наружу выходит поток для волны
// и итог записи: кусок звука или названная неудача, без исключений.
import { VOICE_MIN_MS, voiceSupport, type VoiceFailure, type VoiceSupport } from "../core/voice";

export type RecordingResult = { kind: "audio"; blob: Blob; mimeType: string } | { kind: "failed"; failure: VoiceFailure };

export type Recording = {
  stream: MediaStream;
  /** Останавливает запись и отдаёт звук; повторный вызов отдаёт тот же итог. */
  finish: () => Promise<RecordingResult>;
  /** Останавливает запись и выбрасывает звук. */
  cancel: () => void;
};

// Порядок как у композера bb: webm в Chromium и Firefox, mp4 в Safari.
const MIME_TYPES = ["audio/webm", "audio/mp4", "audio/ogg"];

export const browserVoiceSupport = (): VoiceSupport =>
  voiceSupport({
    isSecureContext: globalThis.isSecureContext !== false,
    hasGetUserMedia: typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function",
    hasMediaRecorder: typeof globalThis.MediaRecorder === "function",
  });

const acquireFailure = (error: unknown): VoiceFailure => {
  const name = error instanceof DOMException || error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "no-microphone";
  return "recording-failed";
};

/** `onFailure` — сбой записи посреди неё, пока никто не ждёт `finish`. */
export const startRecording = async (onFailure: (failure: VoiceFailure) => void): Promise<{ kind: "started"; recording: Recording } | { kind: "failed"; failure: VoiceFailure }> => {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    return { kind: "failed", failure: acquireFailure(error) };
  }
  // Микрофон освобождается ровно один раз, какой бы путь ни закончил запись: иначе горит индикатор записи.
  let released = false;
  const release = () => {
    if (!released) stream.getTracks().forEach((track) => track.stop());
    released = true;
  };
  const mimeType = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
  let recorder: MediaRecorder;
  try {
    recorder = mimeType === undefined ? new MediaRecorder(stream) : new MediaRecorder(stream, { mimeType });
  } catch {
    release();
    return { kind: "failed", failure: "recording-failed" };
  }

  const chunks: Blob[] = [];
  const startedAt = Date.now();
  let discard = false;
  let settle: (result: RecordingResult) => void = () => {};
  const result = new Promise<RecordingResult>((resolve) => (settle = resolve));

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.onerror = () => {
    release();
    settle({ kind: "failed", failure: "recording-failed" });
    if (!discard) onFailure("recording-failed");
    discard = true;
  };
  recorder.onstop = () => {
    release();
    if (Date.now() - startedAt < VOICE_MIN_MS) return settle({ kind: "failed", failure: "too-short" });
    if (chunks.length === 0) return settle({ kind: "failed", failure: "no-audio" });
    const type = recorder.mimeType || mimeType || "audio/webm";
    settle({ kind: "audio", blob: new Blob(chunks, { type }), mimeType: type });
  };
  try {
    recorder.start();
  } catch {
    release();
    return { kind: "failed", failure: "recording-failed" };
  }

  const stop = () => {
    if (recorder.state !== "inactive") recorder.stop();
  };
  return {
    kind: "started",
    recording: {
      stream,
      finish: () => {
        stop();
        return result;
      },
      cancel: () => {
        discard = true;
        stop();
        release();
      },
    },
  };
};
