import { describe, expect, it, vi } from "vitest";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { resolveSource, type OpenerSource } from "./opener-source";

// A minimal bb.sdk mock: only the calls resolveSource touches.
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
  it("workspace → root = the environment's path, host from the same place", async () => {
    const { bb } = makeBb({ env: { path: "/env/root", hostId: "h1" } });
    const r = await resolveSource(bb, {
      ...base,
      kind: "workspace",
      environmentId: "e1",
    });
    expect(r).toEqual({ hostId: "h1", root: "/env/root" });
  });

  it("workspace without environmentId → null", async () => {
    const { bb } = makeBb({});
    expect(
      await resolveSource(bb, { ...base, kind: "workspace" }),
    ).toBeNull();
  });

  it("workspace with an environment that isn't ready yet (path=null) → null", async () => {
    const { bb } = makeBb({ env: { path: null, hostId: "h1" } });
    expect(
      await resolveSource(bb, { ...base, kind: "workspace", environmentId: "e1" }),
    ).toBeNull();
  });

  it("thread-storage → root = storageRootPath, host from the environment", async () => {
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

  it("thread-storage without threadId → null", async () => {
    const { bb } = makeBb({});
    expect(
      await resolveSource(bb, { ...base, kind: "thread-storage", environmentId: "e1" }),
    ).toBeNull();
  });

  it("host → no root fence; host is undefined when there's no environment", async () => {
    const { bb, envGet } = makeBb({});
    const r = await resolveSource(bb, { ...base, kind: "host" });
    expect(r).toEqual({ hostId: undefined, root: undefined });
    expect(envGet).not.toHaveBeenCalled();
  });

  it("host with an environment → host comes from the environment, still no root", async () => {
    const { bb } = makeBb({ env: { path: "/x", hostId: "h3" } });
    const r = await resolveSource(bb, {
      ...base,
      kind: "host",
      environmentId: "e1",
    });
    expect(r).toEqual({ hostId: "h3", root: undefined });
  });
});
