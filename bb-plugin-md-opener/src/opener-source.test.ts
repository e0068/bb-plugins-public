import { describe, expect, it, vi } from "vitest";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { resolveSource, type OpenerSource } from "./opener-source";

// Мини-мок bb.sdk: только вызовы, которые трогает resolveSource.
function makeBb(opts: {
  env?: { path: string | null; hostId: string };
  storageRootPath?: string;
}): { bb: BbPluginApi; envGet: ReturnType<typeof vi.fn>; storage: ReturnType<typeof vi.fn> } {
  const envGet = vi.fn(async () => opts.env ?? { path: null, hostId: "h-env" });
  const storage = vi.fn(async () => ({
    storageRootPath: opts.storageRootPath ?? "/store",
  }));
  const bb = {
    sdk: {
      environments: { get: envGet },
      threads: { storageFiles: storage },
    },
  } as unknown as BbPluginApi;
  return { bb, envGet, storage };
}

const base: Omit<OpenerSource, "kind"> = {
  threadId: null,
  environmentId: null,
  projectId: null,
};

describe("resolveSource", () => {
  it("workspace → корень = путь окружения, хост оттуда же", async () => {
    const { bb } = makeBb({ env: { path: "/env/root", hostId: "h1" } });
    const r = await resolveSource(bb, {
      ...base,
      kind: "workspace",
      environmentId: "e1",
    });
    expect(r).toEqual({ hostId: "h1", root: "/env/root" });
  });

  it("workspace без environmentId → null", async () => {
    const { bb } = makeBb({});
    expect(
      await resolveSource(bb, { ...base, kind: "workspace" }),
    ).toBeNull();
  });

  it("workspace с ещё не готовым окружением (path=null) → null", async () => {
    const { bb } = makeBb({ env: { path: null, hostId: "h1" } });
    expect(
      await resolveSource(bb, { ...base, kind: "workspace", environmentId: "e1" }),
    ).toBeNull();
  });

  it("thread-storage → корень = storageRootPath, хост из окружения", async () => {
    const { bb, storage } = makeBb({
      env: { path: "/x", hostId: "h2" },
      storageRootPath: "/thread/store",
    });
    const r = await resolveSource(bb, {
      ...base,
      kind: "thread-storage",
      threadId: "t1",
      environmentId: "e1",
    });
    expect(r).toEqual({ hostId: "h2", root: "/thread/store" });
    expect(storage).toHaveBeenCalledWith({ threadId: "t1" });
  });

  it("thread-storage без threadId → null", async () => {
    const { bb } = makeBb({});
    expect(
      await resolveSource(bb, { ...base, kind: "thread-storage", environmentId: "e1" }),
    ).toBeNull();
  });

  it("host → без корня-фенса; хост undefined, если нет окружения", async () => {
    const { bb, envGet } = makeBb({});
    const r = await resolveSource(bb, { ...base, kind: "host" });
    expect(r).toEqual({ hostId: undefined, root: undefined });
    expect(envGet).not.toHaveBeenCalled();
  });

  it("host с окружением → хост берётся из окружения, корня всё равно нет", async () => {
    const { bb } = makeBb({ env: { path: "/x", hostId: "h3" } });
    const r = await resolveSource(bb, {
      ...base,
      kind: "host",
      environmentId: "e1",
    });
    expect(r).toEqual({ hostId: "h3", root: undefined });
  });
});
