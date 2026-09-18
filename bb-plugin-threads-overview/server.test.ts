import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

type Sdk = NonNullable<Parameters<typeof createFakePluginHost>[0]["sdk"]>;

const EXECUTION = {
  model: "claude-opus-5",
  reasoningLevel: "high",
  permissionMode: "auto",
  serviceTier: "default",
  source: "client/turn/requested",
};

const available = (aheadCount: number | null, hasUncommittedChanges: boolean) => ({
  outcome: "available",
  workspace: {
    mergeBase: aheadCount === null ? null : { aheadCount },
    workingTree: { hasUncommittedChanges },
  },
});

async function details(sdk: Sdk) {
  const { bb, harness } = createFakePluginHost({ pluginId: "threads-overview", sdk });
  await plugin(bb);
  return {
    result: await harness.behavior.callRpc("threadDetails", { threadId: "th_1" }),
    harness,
  };
}

const withThread = (environmentId: string | null) => ({
  defaultExecutionOptions: async () => EXECUTION,
  get: async () => ({ id: "th_1", environmentId }),
});

describe("threadDetails rpc", () => {
  it("reads the thread's model, effort and mode, and its branch's commits and edits", async () => {
    const { result, harness } = await details({
      threads: withThread("env_1"),
      environments: { status: async () => available(2, true) },
    } as unknown as Sdk);

    expect(result).toEqual({
      execution: { model: "claude-opus-5", reasoningLevel: "high", permissionMode: "auto" },
      git: { commitsAhead: 2, uncommitted: true },
    });
    expect(harness.sdk.callsTo("environments.status")[0]![0]).toMatchObject({
      environmentId: "env_1",
    });
  });

  it("counts no commits when the branch has no merge base yet", async () => {
    const { result } = await details({
      threads: withThread("env_1"),
      environments: { status: async () => available(null, false) },
    } as unknown as Sdk);
    expect(result).toMatchObject({ git: { commitsAhead: 0, uncommitted: false } });
  });

  it("has no git state for a thread without an environment or outside git", async () => {
    const noEnvironment = await details({ threads: withThread(null) } as unknown as Sdk);
    expect(noEnvironment.result).toMatchObject({ git: null });

    const notGit = await details({
      threads: withThread("env_1"),
      environments: { status: async () => ({ outcome: "not_applicable", reason: "non_git_environment", message: "" }) },
    } as unknown as Sdk);
    expect(notGit.result).toMatchObject({ git: null });
  });

  it("answers with what it could read when the host fails part of the lookup", async () => {
    const { result } = await details({
      threads: {
        defaultExecutionOptions: async () => {
          throw new Error("offline");
        },
        get: async () => ({ id: "th_1", environmentId: "env_1" }),
      },
      environments: {
        status: async () => {
          throw new Error("offline");
        },
      },
    } as unknown as Sdk);
    expect(result).toEqual({ execution: null, git: null });
  });

  it("has no execution options for a thread that never resolved any", async () => {
    const { result } = await details({
      threads: { defaultExecutionOptions: async () => null, get: async () => ({ id: "th_1", environmentId: null }) },
    } as unknown as Sdk);
    expect(result).toEqual({ execution: null, git: null });
  });
});

describe("preview size settings", () => {
  it("declares the window's width and height next to the preview delay", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "threads-overview" });
    await plugin(bb);
    const keys = Object.keys(harness.registrations.settingsDescriptors);
    expect(keys).toEqual(
      expect.arrayContaining(["previewDelaySeconds", "previewWidth", "previewHeight"]),
    );
  });
});
