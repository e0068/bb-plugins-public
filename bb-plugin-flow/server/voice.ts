// RPC голосового ввода: звук поля брифа уходит в распознавание bb — то же,
// что у композера, — а виджет получает текст или названную неудачу.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { audioFileName, normalizeTranscript } from "../core/voice";
import { voiceRpcContract } from "../shared/contract";

export const registerVoiceApi = (bb: Pick<BbPluginApi, "rpc" | "sdk">): void => {
  bb.rpc.register(voiceRpcContract, {
    async transcribeVoice({ audio, mimeType, prompt }) {
      const file = new File([Buffer.from(audio, "base64")], audioFileName(mimeType), { type: mimeType });
      try {
        const { text } = await bb.sdk.system.transcribeVoice(prompt === undefined ? { file } : { file, prompt });
        const normalized = normalizeTranscript(text);
        return normalized === "" ? { kind: "failed" as const, reason: "empty" as const } : { kind: "transcribed" as const, text: normalized };
      } catch (error) {
        // Причина от bb уходит виджету: «Codex: Not responding» говорит владельцу, что отказал сервис, а не запись.
        const detail = error instanceof Error ? error.message.trim() : "";
        return { kind: "failed" as const, reason: "unavailable" as const, ...(detail === "" ? {} : { detail }) };
      }
    },
  });
};
