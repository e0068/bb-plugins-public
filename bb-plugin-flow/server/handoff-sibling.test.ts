// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { DecisionBrief } from "../shared/contract";
import { handoff } from "./handoff";

const brief: DecisionBrief = {
  id: "dec_1",
  threadId: "thr_src",
  title: "Flow — соседний тред",
  createdAt: "2026-09-17T10:00:00.000Z",
  kind: "brief",
  questions: [],
};

type Mention = { start: number; end: number; resource: { kind: string; threadId: string; projectId?: string; label: string } };

const spawned = async () => {
  const calls: Array<Record<string, unknown>> = [];
  const sdk = {
    threads: {
      get: async () => ({ id: "thr_src", projectId: "proj_1", environmentId: "env_1", title: "Исходный тред" }),
      spawn: async (args: Record<string, unknown>) => {
        calls.push(args);
        return { id: "thr_new" };
      },
    },
    environments: { get: async () => ({ hostId: "host_1", branchName: "bb/thr_src" }) },
  };
  await handoff({ sdk } as never, { brief, place: "thread", text: "Ответ владельца" });
  return calls[0]!;
};

describe("передача работы соседнему треду", () => {
  it("новый тред — сосед исходного: тот же проект и окружение, без родителя", async () => {
    const call = await spawned();
    expect(call.parentThreadId).toBeUndefined();
    expect(call.projectId).toBe("proj_1");
    expect(call.environment).toEqual({ type: "reuse", environmentId: "env_1" });
  });

  it("первое сообщение упоминает исходный тред, как нативная передача bb", async () => {
    const call = await spawned();
    const [input] = call.input as Array<{ type: string; text: string; mentions: Mention[] }>;
    const [mention] = input!.mentions;
    expect(input!.text.slice(mention!.start, mention!.end)).toBe("@thread:thr_src");
    expect(mention!.resource).toEqual({ kind: "thread", projectId: "proj_1", threadId: "thr_src", label: "Исходный тред" });
    expect(input!.text).toContain("Ответ владельца");
  });
});
