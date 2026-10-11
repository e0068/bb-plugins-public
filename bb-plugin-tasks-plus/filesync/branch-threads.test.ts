import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseBranchThreads, withBranchSlug, type BranchThread } from "./branch-threads.js";

// Память о тредах веток лежит в KV и читается после перезапуска плагина:
// что записано — то и прочитано, а испорченная запись не роняет загрузку.

const text = fc.string({ minLength: 1, maxLength: 12 });

const branchThread: fc.Arbitrary<BranchThread> = fc.record({
  threadId: text,
  environment: fc.record({
    environmentId: text,
    projectId: text,
    path: text,
    name: fc.option(text, { nil: null }),
    branchName: fc.option(text, { nil: null }),
    isWorktree: fc.constant(true),
    hostId: text,
  }),
  slugs: fc.array(text, { maxLength: 4 }),
});

describe("память о тредах веток в KV", () => {
  it("запись, прошедшая через JSON, читается той же", () => {
    fc.assert(
      fc.property(fc.array(branchThread, { maxLength: 5 }), (threads) => {
        expect(parseBranchThreads(JSON.parse(JSON.stringify(threads)))).toEqual(threads);
      }),
    );
  });

  it("запись без дерева на диске или с испорченными полями отбрасывается, остальные читаются", () => {
    fc.assert(
      fc.property(branchThread, (good) => {
        const broken = [
          null,
          "thr_x",
          { ...good, threadId: 7 },
          { ...good, environment: { ...good.environment, isWorktree: false } },
          { ...good, environment: { ...good.environment, path: null } },
          { ...good, slugs: "slug" },
        ];
        expect(parseBranchThreads([...broken, good])).toEqual([good]);
      }),
    );
  });

  it("не массив читается как пустая память", () => {
    expect(parseBranchThreads(undefined)).toEqual([]);
    expect(parseBranchThreads({ threadId: "thr_x" })).toEqual([]);
  });

  it("повторная привязка того же слага ничего не добавляет", () => {
    fc.assert(
      fc.property(branchThread, text, (thread, slug) => {
        const once = withBranchSlug(thread, thread.threadId, thread.environment, slug);
        const twice = withBranchSlug(once, thread.threadId, thread.environment, slug);
        expect(twice.slugs).toEqual(once.slugs);
        expect(once.slugs).toContain(slug);
      }),
    );
  });
});
