// Двойники браузерной записи звука для тестов вида: jsdom не знает ни
// MediaRecorder, ни getUserMedia. Двойник ведёт себя как браузер в том, что
// видит код записи: start → onstart, stop → ondataavailable с куском звука →
// onstop. Время записи тесты двигают через `vi.setSystemTime`.
import { vi } from "vitest";

type Handler<E> = ((event: E) => void) | null;

export class FakeMediaRecorder {
  static readonly instances: FakeMediaRecorder[] = [];
  static isTypeSupported = (type: string): boolean => type === "audio/webm";
  /** Следующий `start` бросит, как браузер, которому не нравится поток. */
  static failNextStart = false;

  readonly mimeType: string;
  state: "inactive" | "recording" = "inactive";
  onstart: Handler<Event> = null;
  onstop: Handler<Event> = null;
  onerror: Handler<Event> = null;
  ondataavailable: Handler<{ data: Blob }> = null;

  constructor(_stream: MediaStream, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? "audio/webm";
    FakeMediaRecorder.instances.push(this);
  }

  start(): void {
    if (FakeMediaRecorder.failNextStart) {
      FakeMediaRecorder.failNextStart = false;
      throw new DOMException("start failed", "NotSupportedError");
    }
    this.state = "recording";
    this.onstart?.(new Event("start"));
  }

  stop(): void {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["voice"], { type: this.mimeType }) });
    this.onstop?.(new Event("stop"));
  }
}

export type MicrophoneFake = { stopped: () => number };

/** Браузер по HTTPS с микрофоном: getUserMedia отдаёт поток или падает с заданной ошибкой. */
export const installMicrophone = (options: { deny?: string } = {}): MicrophoneFake => {
  let stopped = 0;
  const stream = { getTracks: () => [{ stop: () => (stopped += 1) }], getAudioTracks: () => [] } as unknown as MediaStream;
  const getUserMedia = options.deny === undefined ? async () => stream : async () => Promise.reject(new DOMException("denied", options.deny));
  FakeMediaRecorder.instances.length = 0;
  FakeMediaRecorder.failNextStart = false;
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  vi.stubGlobal("isSecureContext", true);
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  return { stopped: () => stopped };
};

/** Браузер без записи звука: нет MediaRecorder и getUserMedia, по HTTPS или нет. */
export const installNoMicrophone = (options: { secure: boolean }): void => {
  vi.stubGlobal("MediaRecorder", undefined);
  vi.stubGlobal("isSecureContext", options.secure);
  Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
};

export const uninstallMicrophone = (): void => {
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
};
