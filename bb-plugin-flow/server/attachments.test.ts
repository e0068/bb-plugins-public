// @vitest-environment node
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import type { DecisionBrief } from "../shared/contract";
import { registerApi } from "./api";
import { createStore } from "./store";

const brief: DecisionBrief = {
  id: "dec_img",
  threadId: "thr_1",
  title: "Уточнение с картинкой",
  createdAt: "2026-09-15T00:00:00.000Z",
  kind: "clarify",
  questions: [{ id: "ok", question: "Так?", kind: "yesno", allowOwn: false, options: [
    { id: "yes", action: "Да", recommended: true },
    { id: "no", action: "Нет", recommended: false },
  ] }],
};

const setup = async () => {
  const root = await mkdtemp(join(tmpdir(), "decisions-att-"));
  const { bb, harness } = createFakePluginHost({
    pluginId: "decisions",
    sdk: { threads: { send: async () => ({ delivery: "started" }), storageLocation: async () => ({ hostId: "local", storageRootPath: root }) } },
  });
  const store = createStore(bb.storage.kv);
  await store.putBrief(brief);
  registerApi(bb, store, { now: () => "2026-09-15T00:05:00.000Z" });
  return { root, harness };
};

describe("картинки ответа", () => {
  it("файл называется номером метки, реплика связывает метку с путём и несёт картинки после текста", async () => {
    const { root, harness } = await setup();
    const images = [
      { n: 1, mimeType: "image/png", dataBase64: Buffer.from("first").toString("base64") },
      { n: 3, mimeType: "image/jpeg", dataBase64: Buffer.from("third").toString("base64") },
    ];
    const result = await harness.callRpc("answerBrief", { id: brief.id, messageId: "msg_1", answer: { briefId: brief.id, answers: [{ questionId: "ok", optionIds: [], own: "смотри [картинка 1] и [картинка 3]" }] }, images });
    expect(result).toMatchObject({ kind: "accepted" });
    const input = (harness.sdk.callsTo("threads.send")[0]![0] as { input: Array<{ type: string; path?: string; text?: string }> }).input;
    const first = join(root, "Attachments", "decision-dec_img-1.png");
    const third = join(root, "Attachments", "decision-dec_img-3.jpg");
    expect(input.map((part) => part.type)).toEqual(["text", "localImage", "localImage"]);
    expect(input.slice(1).map((part) => part.path)).toEqual([first, third]);
    expect(input[0]!.text).toContain(`[картинка 1] — ${first}`);
    expect(input[0]!.text).toContain(`[картинка 3] — ${third}`);
    expect(await readFile(first, "utf8")).toBe("first");
    expect(await readFile(third, "utf8")).toBe("third");
  });
});
