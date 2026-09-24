// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { DecisionBrief, DispatchPlace, DispatchRoute } from "../shared/contract";
import { handoff } from "./handoff";

const brief: DecisionBrief = {
  id: "dec_1",
  threadId: "thr_src",
  title: "Flow — передача с картинками",
  createdAt: "2026-09-24T10:00:00.000Z",
  kind: "brief",
  questions: [],
};

const images = ["decision-dec_1-1-1790000000000-abc123.png", "decision-dec_1-2-1790000000000-def456.jpg"];

const spawned = async (route: DispatchRoute, place: Exclude<DispatchPlace, "here">) => {
  const spawns: Array<Record<string, unknown>> = [];
  const copies: Array<Record<string, unknown>> = [];
  const sdk = {
    threads: {
      get: async () => ({ id: "thr_src", projectId: "proj_1", environmentId: "env_1", title: "Исходный тред" }),
      spawn: async (args: Record<string, unknown>) => {
        spawns.push(args);
        return { id: "thr_new" };
      },
    },
    environments: { get: async () => ({ hostId: "host_1", branchName: "bb/thr_src", path: "/w/thr_src" }) },
    projects: { attachments: { copy: async (args: Record<string, unknown>) => void copies.push(args) } },
  };
  const result = await handoff({ sdk } as never, { brief, place, route, text: "Ответ владельца", images });
  return { input: spawns[0]?.input as Array<{ type: string; path?: string }> | undefined, copies, result };
};

describe("картинки ответа при передаче работы в новый тред", () => {
  it("тред того же проекта получает картинки после текста первого сообщения, без копирования", async () => {
    const { input, copies } = await spawned({ tree: "same", branch: "none" }, "thread");
    expect(input?.map((part) => part.type)).toEqual(["text", "localImage", "localImage"]);
    expect(input?.slice(1).map((part) => part.path)).toEqual(images);
    expect(copies).toEqual([]);
  });

  it("тред другого проекта получает картинки, скопированные в его проект до создания треда", async () => {
    const { input, copies } = await spawned({ tree: "new", branch: "none", projectId: "proj_2" }, "other");
    expect(copies).toEqual([{ projectId: "proj_2", sourceProjectId: "proj_1", paths: images }]);
    expect(input?.slice(1).map((part) => part.path)).toEqual(images);
  });
});
