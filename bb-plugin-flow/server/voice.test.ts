// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { voiceRpcContract } from "../shared/contract";
import { registerVoiceApi } from "./voice";

type TranscribeArgs = { file: Blob; prompt?: string };

const setup = (transcribe: (args: TranscribeArgs) => Promise<{ text: string }>) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "decisions", sdk: { system: { transcribeVoice: transcribe } } });
  registerVoiceApi(bb);
  return harness;
};

const audio = Buffer.from("fake opus bytes").toString("base64");

describe("RPC распознавания голоса", () => {
  it("отдаёт звук в bb.sdk.system.transcribeVoice файлом с именем по типу и подсказкой", async () => {
    const calls: TranscribeArgs[] = [];
    const harness = setup(async (args) => {
      calls.push(args);
      return { text: "  Привет,\n мир  " };
    });

    expect(await harness.callRpc("transcribeVoice", { audio, mimeType: "audio/webm;codecs=opus", prompt: "до курсора" })).toEqual({ kind: "transcribed", text: "Привет, мир" });
    expect(calls).toHaveLength(1);
    const file = calls[0]!.file as File;
    expect(file.name).toBe("recording.webm");
    expect(file.type).toBe("audio/webm;codecs=opus");
    expect(Buffer.from(await file.arrayBuffer()).toString()).toBe("fake opus bytes");
    expect(calls[0]!.prompt).toBe("до курсора");
  });

  it("без подсказки подсказку не передаёт", async () => {
    const calls: TranscribeArgs[] = [];
    const harness = setup(async (args) => {
      calls.push(args);
      return { text: "текст" };
    });
    await harness.callRpc("transcribeVoice", { audio, mimeType: "audio/mp4" });
    expect(calls[0]!.prompt).toBeUndefined();
    expect((calls[0]!.file as File).name).toBe("recording.mp4");
  });

  it("пустое распознавание — неудача «пусто», а не пустой текст", async () => {
    const harness = setup(async () => ({ text: " \n " }));
    expect(await harness.callRpc("transcribeVoice", { audio, mimeType: "audio/webm" })).toEqual({ kind: "failed", reason: "empty" });
  });

  it("сбой сервиса bb — неудача «недоступно», RPC не падает", async () => {
    const harness = setup(async () => {
      throw new Error("provider down");
    });
    expect(await harness.callRpc("transcribeVoice", { audio, mimeType: "audio/webm" })).toEqual({ kind: "failed", reason: "unavailable" });
  });

  it("контракт не принимает пустой звук", () => {
    expect(voiceRpcContract.transcribeVoice.input.safeParse({ audio: "", mimeType: "audio/webm" }).success).toBe(false);
    expect(voiceRpcContract.transcribeVoice.input.safeParse({ audio, mimeType: "audio/webm" }).success).toBe(true);
  });
});
