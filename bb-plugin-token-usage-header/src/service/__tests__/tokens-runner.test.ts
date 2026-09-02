// Tests the mapping logic in createTokensRunner with an injected fake
// ProcessRunner — no real python/process involved, so these are fast and
// deterministic. process-runner.test.ts covers the real adapter separately.
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createTokensRunner, defaultScriptPath, resolvePluginRoot } from "../tokens-runner";
import type { ProcessRunner, ProcessRunResult } from "../process-runner";

const VALID_STDOUT = JSON.stringify({
  schemaVersion: 2,
  by: "session",
  buckets: [],
  totals: {
    total: 0,
    input: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    cacheRead: 0,
    output: 0,
    thinking: 0,
    messages: 0,
    cost: 0,
    costs: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, thinking: 0 },
    models: [],
    buckets: 0,
  },
  truncated: false,
});

function fakeRunner(impl: (command: string, args: readonly string[]) => Promise<ProcessRunResult> | ProcessRunResult) {
  const calls: { command: string; args: readonly string[] }[] = [];
  const runner: ProcessRunner = async (command, args) => {
    calls.push({ command, args });
    return impl(command, args);
  };
  return { runner, calls };
}

describe("defaultScriptPath", () => {
  it("resolves to an actual file on disk from this module's real location", () => {
    // Regression guard for the finding that nothing asserted this before:
    // defaultScriptPath() must point at a script that exists, not just build
    // a plausible-looking string.
    const path = defaultScriptPath();
    expect(existsSync(path)).toBe(true);
    expect(path.endsWith("tools/tokens.py") || path.endsWith("tools\\tokens.py")).toBe(true);
  });
});

describe("resolvePluginRoot", () => {
  it("finds the plugin root by walking up from a source-layout module (src/service/)", () => {
    const exists = (p: string) => p === "/plugin/tools/tokens.py";
    const root = resolvePluginRoot("/plugin/src/service", exists);
    expect(root).toBe("/plugin");
  });

  it("finds the plugin root by walking up from a bundled-layout module (dist/)", () => {
    const exists = (p: string) => p === "/plugin/tools/tokens.py";
    const root = resolvePluginRoot("/plugin/dist", exists);
    expect(root).toBe("/plugin");
  });

  it("returns null when no ancestor directory has tools/tokens.py", () => {
    const root = resolvePluginRoot("/somewhere/deep/nested/dir", () => false);
    expect(root).toBeNull();
  });

  it("does not walk past the filesystem root", () => {
    let calls = 0;
    resolvePluginRoot("/", () => {
      calls++;
      return false;
    });
    expect(calls).toBe(1);
  });
});

describe("createTokensRunner", () => {
  it("parses a successful run's stdout into a report", async () => {
    const { runner } = fakeRunner(() => ({ ok: true, stdout: VALID_STDOUT, stderr: "", code: 0 }));
    const tokensRunner = createTokensRunner({ processRunner: runner, scriptPath: "/plugin/tools/tokens.py" });

    const result = await tokensRunner.run({ by: "session" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.by).toBe("session");
  });

  it("passes CLI args built from the slice params, plus --json and the script path", async () => {
    const { runner, calls } = fakeRunner(() => ({ ok: true, stdout: VALID_STDOUT, stderr: "", code: 0 }));
    const tokensRunner = createTokensRunner({ processRunner: runner, scriptPath: "/plugin/tools/tokens.py" });

    await tokensRunner.run({ by: "agent", session: "71e96791", top: 10 });
    expect(calls[0].args).toEqual(["/plugin/tools/tokens.py", "--json", "--by", "agent", "--session", "71e96791", "--top", "10"]);
  });

  it("reports python_not_found when neither python3 nor python resolves", async () => {
    const { runner, calls } = fakeRunner(() => ({ ok: false, reason: "not_found", message: "nope" }));
    const tokensRunner = createTokensRunner({ processRunner: runner });

    const result = await tokensRunner.run({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("python_not_found");
    expect(calls.map((c) => c.command)).toEqual(["python3", "python"]);
  });

  it("falls back from python3 to python and remembers the working interpreter", async () => {
    const { runner, calls } = fakeRunner((command) =>
      command === "python3"
        ? { ok: false, reason: "not_found", message: "no python3" }
        : { ok: true, stdout: VALID_STDOUT, stderr: "", code: 0 },
    );
    const tokensRunner = createTokensRunner({ processRunner: runner });

    const first = await tokensRunner.run({});
    expect(first.ok).toBe(true);
    expect(calls.map((c) => c.command)).toEqual(["python3", "python"]);

    calls.length = 0;
    const second = await tokensRunner.run({});
    expect(second.ok).toBe(true);
    expect(calls.map((c) => c.command)).toEqual(["python"]);
  });

  it("maps a timeout without retrying the other interpreter", async () => {
    const { runner, calls } = fakeRunner(() => ({ ok: false, reason: "timeout", message: "timed out" }));
    const tokensRunner = createTokensRunner({ processRunner: runner });

    const result = await tokensRunner.run({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("timeout");
    expect(calls).toHaveLength(1);
  });

  it("treats non-JSON garbage on stdout as invalid_output, not a thrown error", async () => {
    const { runner } = fakeRunner(() => ({ ok: true, stdout: "not json at all {{{", stderr: "", code: 0 }));
    const tokensRunner = createTokensRunner({ processRunner: runner });

    const result = await tokensRunner.run({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_output");
  });

  it("rejects an empty-string session instead of silently dropping the --session filter", async () => {
    const { runner, calls } = fakeRunner(() => ({ ok: true, stdout: VALID_STDOUT, stderr: "", code: 0 }));
    const tokensRunner = createTokensRunner({ processRunner: runner, scriptPath: "/plugin/tools/tokens.py" });

    const result = await tokensRunner.run({ by: "agent", session: "" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_session");
    // Must never spawn the process — an empty session would silently sum
    // every project instead of "this thread only".
    expect(calls).toHaveLength(0);
  });

  it("gives interpreter fallback a shared deadline instead of a fresh timeout per attempt", async () => {
    const seenTimeouts: number[] = [];
    const runner: ProcessRunner = async (command, _args, options) => {
      seenTimeouts.push(options?.timeoutMs ?? -1);
      if (command === "python3") {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { ok: false, reason: "not_found", message: "no python3" };
      }
      return { ok: true, stdout: VALID_STDOUT, stderr: "", code: 0 };
    };
    const tokensRunner = createTokensRunner({ processRunner: runner, timeoutMs: 1000 });

    const result = await tokensRunner.run({});

    expect(result.ok).toBe(true);
    expect(seenTimeouts).toHaveLength(2);
    expect(seenTimeouts[0]).toBeLessThanOrEqual(1000);
    // The second attempt must have a shrunk budget reflecting the ~50ms the
    // first attempt already spent — not a fresh 1000ms of its own, which
    // would let the two-attempt fallback take up to 2x the configured
    // timeout in the worst case.
    expect(seenTimeouts[1]).toBeLessThanOrEqual(960);
  }, 10_000);

  it("recognizes tokens.py's own {error: ...} envelope as script_error", async () => {
    const { runner } = fakeRunner(() => ({
      ok: true,
      stdout: JSON.stringify({ error: "boom: transcript directory missing" }),
      stderr: "",
      code: 1,
    }));
    const tokensRunner = createTokensRunner({ processRunner: runner });

    const result = await tokensRunner.run({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("script_error");
    expect(result.message).toBe("boom: transcript directory missing");
  });

  // Regression coverage for the bug report this fix addresses: a process
  // that exits (any code) with empty stdout used to surface only the
  // generic parse-layer message "empty output", discarding whatever
  // diagnostic the script actually printed to stderr — e.g. Python failing
  // to even open tools/tokens.py (missing file, bad install layout) prints
  // its traceback to stderr and produces nothing on stdout at all.
  it("folds stderr and the exit code into the message when the process produced no usable stdout", async () => {
    const { runner } = fakeRunner(() => ({
      ok: true,
      stdout: "",
      stderr: "python3: can't open file 'tools/tokens.py': [Errno 2] No such file or directory\n",
      code: 2,
    }));
    const tokensRunner = createTokensRunner({ processRunner: runner });

    const result = await tokensRunner.run({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_output");
    expect(result.message).toContain("empty output");
    expect(result.message).toContain("exit code 2");
    expect(result.message).toContain("No such file or directory");
  });

  it("folds stderr into the message when stdout parsed but wasn't valid JSON", async () => {
    const { runner } = fakeRunner(() => ({
      ok: true,
      stdout: "Traceback (most recent call last):\n  File ...",
      stderr: "some diagnostic on stderr too",
      code: 1,
    }));
    const tokensRunner = createTokensRunner({ processRunner: runner });

    const result = await tokensRunner.run({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_output");
    expect(result.message).toContain("some diagnostic on stderr too");
  });

  it("does not append an empty stderr to the parse failure message", async () => {
    const { runner } = fakeRunner(() => ({ ok: true, stdout: "", stderr: "", code: 0 }));
    const tokensRunner = createTokensRunner({ processRunner: runner });

    const result = await tokensRunner.run({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe("empty output");
  });

  it("does not fold stderr into a recognized script_error envelope — that message is already the whole story", async () => {
    const { runner } = fakeRunner(() => ({
      ok: true,
      stdout: JSON.stringify({ error: "boom" }),
      stderr: "some incidental warning on stderr",
      code: 1,
    }));
    const tokensRunner = createTokensRunner({ processRunner: runner });

    const result = await tokensRunner.run({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("script_error");
    expect(result.message).toBe("boom");
  });
});
